import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { ContractService } from '../../src/stellar/contract.service';
import { CacheService } from '../../src/cache/cache.service';
import {
  ConfigService,
  AutoReleaseSourceNotConfiguredError,
} from '../../src/config/config.service';
import { ensureVendors } from '../prisma-helpers';

/**
 * Issue #277 — Integration tests for concurrent auto-release collision detection.
 *
 * Verifies that when two worker instances attempt to release the same escrow
 * simultaneously, only one succeeds and the other gracefully fails. Tests the
 * DB-level optimistic locking via autoReleaseSubmittedAt.
 */
describe('Auto-release collision detection (issue #277)', () => {
  let prisma: PrismaService;
  let escrowRepository: EscrowRepository;
  let contractService: jest.Mocked<ContractService>;
  let worker: AutoReleaseWorker;

  const pastDelivery = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  let nextContractEscrowId = 1n;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        EscrowRepository,
        DisputeRepository,
        AutoReleaseWorker,
        {
          provide: ContractService,
          useValue: {
            submitAutoRelease: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            // The worker resolves AUTO_RELEASE_SOURCE_ADDRESS on use and
            // throws when it is unset. setup-env.ts loads .env.test, which
            // supplies it.
            get: jest.fn((key: string) => process.env[key]),
            requireAutoReleaseSourceAddress: jest.fn(() => {
              const address = process.env.AUTO_RELEASE_SOURCE_ADDRESS;
              if (!address) {
                throw new AutoReleaseSourceNotConfiguredError();
              }
              return address;
            }),
          },
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    escrowRepository = moduleRef.get(EscrowRepository);
    contractService =
      moduleRef.get<jest.Mocked<ContractService>>(ContractService);
    worker = moduleRef.get(AutoReleaseWorker);

    nextContractEscrowId = 1n;
    await prisma.reset();
    // Escrow.vendorAddress (and the vendor settings/details tables) are
    // foreign keys onto VendorProfile.address, so the parent rows must exist
    // before any row referencing them can be written (#475).
    await ensureVendors(
      prisma,
      'vendor-1',
      'vendor-2',
      'vendor-3',
      'vendor-4',
      'vendor-5',
      'vendor-6',
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.reset();
  });

  /**
   * Creates a SHIPPED escrow and moves it to DELIVERED through the same
   * repository method production uses.
   *
   * Fixtures must not write `deliveredAt` directly alongside a non-DELIVERED
   * state. `markDelivered` is the only writer of `deliveredAt` and sets
   * `state: 'DELIVERED'` in the same update, so SHIPPED-with-a-deliveredAt is
   * a row the application cannot produce. Fixtures that wrote it by hand are
   * what let the eligibility bug survive a full suite of passing tests (#395).
   */
  const createDeliveredEscrow = async (data: {
    itemName: string;
    itemRef: string;
    amount: number;
    buyerAddress: string;
    vendorAddress: string;
    trackingId: string;
    autoReleaseTxHash?: string;
  }) => {
    const { autoReleaseTxHash, ...rest } = data;
    // The contract mints its own u64 and every on-chain call addresses the
    // escrow by that, not by this row's UUID. Fixtures have to carry both or
    // they cannot exercise the call path at all.
    const escrow = await prisma.escrow.create({
      data: {
        ...rest,
        currency: 'USDC',
        state: 'SHIPPED',
        contractEscrowId: nextContractEscrowId++,
        shippedAt: new Date(pastDelivery.getTime() - 24 * 60 * 60 * 1000),
      },
    });
    await escrowRepository.markDelivered(escrow.id, pastDelivery);
    if (autoReleaseTxHash) {
      await prisma.escrow.update({
        where: { id: escrow.id },
        data: { autoReleaseTxHash },
      });
    }
    return escrow;
  };

  // ── markAutoReleaseSubmitting optimistic locking ──────────────────────────

  describe('markAutoReleaseSubmitting', () => {
    it('claims the escrow and returns the record on first call', async () => {
      const escrow = await createDeliveredEscrow({
        itemName: 'Camera',
        itemRef: 'camera-lock-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
      });

      const result = await escrowRepository.markAutoReleaseSubmitting(
        escrow.id,
      );

      expect(result).not.toBeNull();
      expect(result!.autoReleaseSubmittedAt).toBeInstanceOf(Date);
      expect(result!.id).toBe(escrow.id);
    });

    it('returns null when the lock is already held', async () => {
      const escrow = await createDeliveredEscrow({
        itemName: 'Laptop',
        itemRef: 'laptop-lock-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
      });

      // First claim succeeds
      const first = await escrowRepository.markAutoReleaseSubmitting(escrow.id);
      expect(first).not.toBeNull();

      // Second claim fails — lock is held
      const second = await escrowRepository.markAutoReleaseSubmitting(
        escrow.id,
      );
      expect(second).toBeNull();
    });

    it('returns null for a non-existent escrow', async () => {
      const result =
        await escrowRepository.markAutoReleaseSubmitting('non-existent-id');
      expect(result).toBeNull();
    });

    it('allows re-claiming after lock is cleared', async () => {
      const escrow = await createDeliveredEscrow({
        itemName: 'Tablet',
        itemRef: 'tablet-lock-001',
        amount: 400,
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-3',
        trackingId: 'TRK-003',
      });

      // Claim
      const first = await escrowRepository.markAutoReleaseSubmitting(escrow.id);
      expect(first).not.toBeNull();

      // Clear lock
      await escrowRepository.clearAutoReleaseSubmitting(escrow.id);

      // Re-claim succeeds
      const second = await escrowRepository.markAutoReleaseSubmitting(
        escrow.id,
      );
      expect(second).not.toBeNull();
    });
  });

  // ── Concurrent auto-release via AutoReleaseWorker ─────────────────────────

  describe('concurrent AutoReleaseWorker.run()', () => {
    it('only submits one transaction when two workers race on the same escrow', async () => {
      const escrow = await createDeliveredEscrow({
        itemName: 'Camera',
        itemRef: 'camera-concurrent-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
      });

      contractService.submitAutoRelease.mockResolvedValue('tx-hash-1');

      // Run two concurrent workers
      await Promise.all([worker.run(), worker.run()]);

      // Only one submission should have occurred
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
        escrow.contractEscrowId,
        expect.any(String),
      );

      // Escrow state should be consistent
      const after = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      // A successful submission records the hash and leaves the escrow
      // DELIVERED. The terminal transition belongs to the AutoReleased chain
      // event, which is what confirms the transaction actually landed.
      expect(after!.state).toBe('DELIVERED');
      expect(after!.autoReleaseTxHash).toBe('tx-hash-1');
    });

    it('releases the lock on failure so the next cycle can retry', async () => {
      const escrow = await createDeliveredEscrow({
        itemName: 'Monitor',
        itemRef: 'monitor-fail-001',
        amount: 300,
        buyerAddress: 'buyer-4',
        vendorAddress: 'vendor-4',
        trackingId: 'TRK-004',
      });

      // First call fails, second succeeds
      contractService.submitAutoRelease
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce('tx-hash-2');

      // First run: fails and releases lock
      await worker.run();

      const afterFirst = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterFirst!.state).toBe('DELIVERED');
      expect(afterFirst!.autoReleaseSubmittedAt).toBeNull();

      // Second run: retries and succeeds
      await worker.run();

      const afterSecond = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterSecond!.state).toBe('DELIVERED');
      expect(afterSecond!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('processes multiple escrows concurrently without collision', async () => {
      const escrow1 = await createDeliveredEscrow({
        itemName: 'Camera',
        itemRef: 'camera-multi-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
      });

      const escrow2 = await createDeliveredEscrow({
        itemName: 'Laptop',
        itemRef: 'laptop-multi-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
      });

      // Keyed by escrow id rather than call order: the worker processes
      // whatever findAutoReleaseEligible returns, so a call-order mock attaches
      // the wrong hash to the wrong escrow whenever that order differs.
      const hashes = new Map<bigint, string>([
        [escrow1.contractEscrowId!, 'tx-hash-a'],
        [escrow2.contractEscrowId!, 'tx-hash-b'],
      ]);
      contractService.submitAutoRelease.mockImplementation(
        (contractEscrowId: bigint) =>
          hashes.has(contractEscrowId)
            ? Promise.resolve(hashes.get(contractEscrowId)!)
            : Promise.reject(
                new Error(`unexpected escrow ${contractEscrowId}`),
              ),
      );

      await worker.run();

      // Both escrows should be released
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      expect(after1!.state).toBe('DELIVERED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-a');

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('DELIVERED');
      expect(after2!.autoReleaseTxHash).toBe('tx-hash-b');
    });

    it('skips escrows that are already auto-released', async () => {
      await createDeliveredEscrow({
        itemName: 'Headphones',
        itemRef: 'headphones-skip-001',
        amount: 80,
        buyerAddress: 'buyer-5',
        vendorAddress: 'vendor-5',
        trackingId: 'TRK-005',
        autoReleaseTxHash: 'existing-tx-hash',
      });

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });

    it('skips escrows with active disputes', async () => {
      const escrow = await createDeliveredEscrow({
        itemName: 'Phone',
        itemRef: 'phone-dispute-001',
        amount: 800,
        buyerAddress: 'buyer-6',
        vendorAddress: 'vendor-6',
        trackingId: 'TRK-006',
      });

      const dispute = await prisma.dispute.create({
        data: {
          escrowId: escrow.id,
          reason: 'ITEM_NOT_AS_DESCRIBED',
          description: 'Phone has defects',
          status: 'OPEN',
        },
      });
      // Mirror production: BuyerDisputeService links the dispute and moves the
      // escrow to DISPUTED. The in-memory PrismaService applied that side
      // effect inside dispute.create itself, so this test got it for free; the
      // real client does not (#475).
      await prisma.escrow.update({
        where: { id: escrow.id },
        data: { disputeId: dispute.id, state: 'DISPUTED' },
      });

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });
  });
});
