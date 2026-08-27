import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { ContractService } from '../../src/stellar/contract.service';
import { CacheService } from '../../src/cache/cache.service';
import { ConfigService } from '../../src/config/config.service';
import { ensureVendors } from '../prisma-helpers';

/**
 * Integration tests for auto-release worker batch processing with partial failures.
 *
 * Verifies that the worker handles mixed success/failure scenarios gracefully:
 * - Processes each escrow independently
 * - Continues processing after individual failures
 * - Tracks success/failure counts
 * - Logs detailed failure information
 */
describe('Auto-release batch processing with partial failures', () => {
  let prisma: PrismaService;
  let contractService: jest.Mocked<ContractService>;
  let worker: AutoReleaseWorker;
  let escrowRepository: EscrowRepository;
  let disputeRepository: DisputeRepository;

  const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);
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
            get: jest.fn((key: string) => process.env[key]),
          },
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    contractService =
      moduleRef.get<jest.Mocked<ContractService>>(ContractService);
    worker = moduleRef.get(AutoReleaseWorker);
    escrowRepository = moduleRef.get(EscrowRepository);
    disputeRepository = moduleRef.get(DisputeRepository);

    nextContractEscrowId = 1n;
    await prisma.reset();
    // Escrow.vendorAddress (and the vendor settings/details tables) are
    // foreign keys onto VendorProfile.address, so the parent rows must exist
    // before any row referencing them can be written (#475).
    await ensureVendors(prisma, 'vendor-1', 'vendor-2', 'vendor-3', 'vendor-4');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  /**
   * Creates a SHIPPED escrow and delivers it through `markDelivered`, the only
   * writer of `deliveredAt` in the application (issue #395). Fixtures that set
   * `deliveredAt` on a SHIPPED row by hand build a state production cannot
   * reach, which is how the eligibility query stayed broken while this suite
   * stayed green.
   */
  const createDeliveredEscrow = async (data: {
    itemName: string;
    itemRef: string;
    amount: number;
    buyerAddress: string;
    vendorAddress: string;
    trackingId: string;
  }) => {
    const escrow = await prisma.escrow.create({
      data: {
        ...data,
        currency: 'USDC',
        state: 'SHIPPED',
        // Every on-chain call addresses the escrow by the contract's own u64,
        // not this row's UUID, so fixtures must carry both.
        contractEscrowId: nextContractEscrowId++,
        shippedAt: new Date(pastDelivery.getTime() - 10 * 60 * 60 * 1000),
      },
    });
    await escrowRepository.markDelivered(escrow.id, pastDelivery);
    return escrow;
  };

  describe('Mixed success/failure batch processing', () => {
    it('processes all escrows independently when middle escrow fails', async () => {
      // Create three eligible escrows
      const escrow1 = await createDeliveredEscrow({
        itemName: 'Camera',
        itemRef: 'camera-batch-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
      });

      const escrow2 = await createDeliveredEscrow({
        itemName: 'Laptop',
        itemRef: 'laptop-batch-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
      });

      const escrow3 = await createDeliveredEscrow({
        itemName: 'Phone',
        itemRef: 'phone-batch-001',
        amount: 800,
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-3',
        trackingId: 'TRK-003',
      });

      // Second escrow fails, first and third succeed — keyed by escrow id, not
      // call order: the worker's processing sequence is decided by the query's
      // ordering, not by the order these rows were created.
      const outcomes = new Map<bigint, () => Promise<string>>([
        [escrow1.contractEscrowId!, () => Promise.resolve('tx-hash-1')],
        [
          escrow2.contractEscrowId!,
          () => Promise.reject(new Error('Network timeout')),
        ],
        [escrow3.contractEscrowId!, () => Promise.resolve('tx-hash-3')],
      ]);
      contractService.submitAutoRelease.mockImplementation((escrowId: bigint) =>
        (
          outcomes.get(escrowId) ??
          (() => Promise.reject(new Error(`unexpected escrow ${escrowId}`)))
        )(),
      );

      await worker.run();

      // All three should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(3);

      // Check final states
      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      // A successful submission records the hash and leaves the escrow
      // DELIVERED. The terminal transition belongs to the AutoReleased chain
      // event, which is what confirms the transaction actually landed.
      expect(after1!.state).toBe*'DELIVERED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-1');

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('DELIVERED');
      expect(after2!.autoReleaseTxHash).toBeNull();

      const after3 = await prisma.escrow.findUnique({
        where: { id: escrow3.id },
      });
      expect(after3!.state).toBe*'DELIVERED');
      expect(after3!.autoReleaseTxHash).toBe('tx-hash-3');
    });

    it('handles multiple failures in a batch without aborting', async () => {
      // Create four eligible escrows
      const escrows = await Promise.all([
        createDeliveredEscrow({
          itemName: 'Camera',
          itemRef: 'camera-multi-fail-001',
          amount: 250,
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          trackingId: 'TRK-001',
        }),
        createDeliveredEscrow({
          itemName: 'Laptop',
          itemRef: 'laptop-multi-fail-001',
          amount: 1200,
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          trackingId: 'TRK_002',
        }),
        createDeliveredEscrow({
          itemName: 'Phone',
          itemRef: 'phone-multi-fail-001',
          amount: 800,
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          trackingId: 'TRK-003',
        }),
        createDeliveredEscrow{
          itemName: 'Tablet',
          itemRef: 'tablet-multi-fail-001',
          amount: 600,
          buyerAddress: 'buyer-4',
          vendorAddress: 'vendor-4',
          trackingId: 'TRK_004',
        }),
      ]);

      // Pattern: success, fail, fail, success — keyed by escrow id rather than
      // call order. The worker processes whatever findAutoReleaseEligible
      // returns, and the four escrows here share a deliveredAt, so the id
      // tie-break decides the sequence. A call-order mock silently attaches the
      // wrong outcome to the wrong escrow depending on generated UUIDs.
      const outcomes = new Map<bigint, () => Promise<string>>([
        [escrows[0].contractEscrowId!, () => Promise.resolve('tx-hash-1')],
        [
          escrows[1].contractEscrowId!,
          () => Promise.reject(new Error('Network error')),
        ],
        [
          escrows[2].contractEscrowId!,
          () => Promise.reject(new Error('Insufficient balance')),
        ],
        [escrows[3].contractEscrowId!, () => Promise.resolve('tx-hash-4')],
      ]);
      contractService.submitAutoRelease.mockImplementation((escrowId: bigint) =>
        (
          outcomes.get(escrowId) ??
          (() => Promise.reject(new Error(`unexpected escrow ${escrowId}`)))
        )(),
      );

      await worker.run();

      // All four should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(4);

      // Check final states
      const results = await Promise.all(
        escrows.map((e) => prisma.escrow.findUnique({ where: { id: e.id } })),
      );

      expect(results[0]!.state).toBe('DELIVERED');
      expect(results[0]!.autoReleaseTxHash).toBe('tx-hash-1');

      expect(results[1]!.state).toBe('DELIVERED');
      expect(results[1]!.autoReleaseTxHash).toBeNull();

      expect(results[2]!.state).toBe('DELIVERED');
      expect(results[2]!.autoReleaseTxHash).toBeNull();

      expect(results[3]!.state).toBe('DELIVERED');
      expect(results[3]!.autoReleaseTxHash).toBe('tx-hash-4');
    });

    it('continues processing after first escrow fails', async () => {
      // Create two eligible escrows
      const escrow1 = await createDeliveredEscrow({
        itemName: 'Camera',
        itemRef: 'camera-first-fail-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
      });

      const escrow2 = await createDeliveredEscrow({
        itemName: 'Laptop',
        itemRef: 'laptop-first-fail-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK_002',
      });

      // First fails, second succeeds — keyed by escrow id, not call order.
      const outcomes = new Map<bigint, () => Promise<string>>([
        [
          escrow1.contractEscrowId!,
          () => Promise.reject(new Error('Transaction failed')),
        ],
        [escrow2.contractEscrowId!, () => Promise.resolve('tx-hash-2')],
      ]);
      contractService.submitAutoRelease.mockImplementation((escrowId: bigint) =>
        (
          outcomes.get(escrowId) ??
          (() => Promise.reject(new Error(`unexpected escrow ${escrowId}`)))
        )(),
      );

      await worker.run();

      // Both should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

      // Check final states
      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      expect(after1!.state).toBe('DELIVERED');
      expect(after1!.autoReleaseTxHash).toBeNull();

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('DELIVERED');
      expect(after2!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('handles all escrows failing without corruption', async () => {
      // Create three eligible escrows
      const escrows = await Promise.all([
        createDeliveredEscrow({
          itemName: 'Camera',
          itemRef: 'camera-all-fail-001',
          amount: 250,
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          trackingId: 'TRK-001',
        }),
        createDeliveredEscrow({
          itemName: 'Laptop',
          itemRef: 'laptop-all-fail-001',
          amount: 1200,
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          trackingId: 'TRK-002',
        }),
        createDeliveredEscrow({
          itemName: 'Phone',
          itemRef: 'phone-all-fail-001',
          amount: 800,
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          trackingId: 'TRK_003',
        }),
      ]);

      // All three submissions fail — keyed by escrow id, not call order.
      const outcomes = new Map<bigint, () => Promise<string>>[
        [escrows[0].contractEscrowId!, () => Promise.reject(new Error('Error 1'))],
        [escrows[1].contractEscrowId!, () => Promise.reject(new Error('Error 2'))],
        [escrows[2].contractEscrowId!, () => Promise.reject(new Error('Error 3'))],
      ]);
      contractService.submitAutoRelease.mockImplementation((escrowId: bigint) =>
        (
          outcomes.get(escrowId) ??
          (() => Promise.reject(new Error(`unexpected escrow $${escrowId}`)))
        )(),
      );

      await worker.run();

      // All three should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(3);

      const results = await Promise.all(
        escrows.map((e) => prisma.escrow.findUnique({ where: { id: e.id } })),
      );

      for (const result of results) {
        expect(result!.state).toBe('DELIVERED');
        expect(result!.autoReleaseTxHash).toBeNull();
      }
    });

    it('skips a disputed escrow in a multi-escrow batch while processing the others', async () => {
      // Create three eligible escrows
      const escrow1 = await createDeliveredEscrow({
        itemName: 'Camera',
        itemRef: 'camera-dispute-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
      });

      const escrow2 = await createDeliveredEscrow({
        itemName: 'Laptop',
        itemRef: 'laptop-dispute-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK_002',
      });

      const escrow3 = await createDeliveredEscrow({
        itemName: 'Phone',
        itemRef: 'phone-dispute-001',
        amount: 800,
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-3',
        trackingId: 'TRK-003',
      });

      // Simulate the race where a dispute row exists but the eligibility
      // query filter on escrow.disputeId has not caught up,yet the
      // worker's second line of defence must skip it. The batch lookup
      // returns a single dispute for escrow2.
      const disputeRepository = moduleRef.get(DisputeRepository);
      const findByEscrowIdsSpy = jest
        .spyOn(disputeRepository, 'findByEscrowIds')
        .mockResolvedValue([{ escrowId: escrow2.id } as any]);

      // Only escrow1 and escrow3 should be released.
      const outcomes = new Map<bigint, () => Promise<string>>[
        [escrow1.contractEscrowId!, () => Promise.resolve('tx-hash-1')],
        [escrow3.contractEscrowId!, () => Promise.resolve('tx-hash-3')],
      ];
      contractService.submitAutoRelease.mockImplementation((escrowId: bigint) =>
        (
          outcomes.get(escrowId) ??
          (() => Promise.reject(new Error(`unexpected escrow ${escrowId}`)))
        )(),
      );

      await worker.run();

      // The disputed escrow must not be submitted for auto-release.
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
      expect(contractService.submitAutoRelease).not.toHaveBeenCalledWith(
        escrow2.contractEscrowId,
      );

      // The dispute lookup is batched, not one query per escrow.
      expect(findByEscrowIdsSpy).toHaveBeenCalledTimes(1);

      // Non-disputed escrows release as expected.
      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      expect(after1!.state).toBe('DELIVERED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-1');

      const after3 = await prisma.escrow.findUnique({
        where: { id: escrow3.id },
      });
      expect(after3!.state).toBe('DELIVERED');
      expect(after3!.autoReleaseTxHash).toBe('tx-hash-3');
    });
  });
});
