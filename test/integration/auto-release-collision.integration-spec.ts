import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { ContractService } from '../../src/stellar/contract.service';
import { CacheService } from '../../src/cache/cache.service';

const TEST_SOURCE_ADDRESS =
  'GA4LQSEGF5UFRB2Q5GFF3S5PEHEGRD547VC6O7RURA37HZ4P4UL6W33C';

function makeConfigService(): Partial<ConfigService> {
  return {
    get: jest.fn((key: string) => {
      if (key === 'AUTO_RELEASE_SOURCE_ADDRESS') {
        return TEST_SOURCE_ADDRESS;
      }
      return undefined as any;
    }) as ConfigService['get'],
  };
}

async function createDeliveredEscrow(
  prisma: PrismaService,
  repository: EscrowRepository,
  overrides: Partial<{
    itemRef: string;
    itemName: string;
    amount: number;
    buyerAddress: string;
    vendorAddress: string;
    trackingId: string;
    deliveredAt: Date;
    shippedAt: Date;
    state: 'DELIVERED' | 'SHIPPED';
    autoReleaseTxHash: string | null;
    disputeId: string | null;
  }>,
) {
  const {
    itemRef,
    itemName,
    amount,
    buyerAddress,
    vendorAddress,
    trackingId,
    deliveredAt,
    shippedAt,
    autoReleaseTxHash,
    disputeId,
  } = overrides;

  const base = await prisma.escrow.create({
    data: {
      itemName: itemName ?? 'Escrow',
      itemRef: itemRef ?? 'ref-default',
      amount: amount ?? 250,
      currency: 'USDC',
      buyerAddress: buyerAddress ?? 'buyer-1',
      vendorAddress: vendorAddress ?? 'vendor-1',
      state: 'SHIPPED',
      trackingId: trackingId ?? 'TRK-DEFAULT',
      shippedAt: shippedAt ?? new Date(Date.now() - 60 * 60 * 60 * 1000),
    },
  });

  const finalDeliveredAt =
    deliveredAt ?? new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  let escrow = await repository.markDelivered(base.id, finalDeliveredAt);

  if (autoReleaseTxHash) {
    escrow = await prisma.escrow.update({
      where: { id: escrow.id },
      data: { autoReleaseTxHash },
    });
  }
  if (disputeId) {
    escrow = await prisma.escrow.update({
      where: { id: escrow.id },
      data: { disputeId },
    });
  }

  return escrow;
}

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
          provide: ConfigService,
          useValue: makeConfigService(),
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    escrowRepository = moduleRef.get(EscrowRepository);
    contractService =
      moduleRef.get<jest.Mocked<ContractService>>(ContractService);
    worker = moduleRef.get(AutoReleaseWorker);

    await prisma.reset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.reset();
  });

  // ── markAutoReleaseSubmitting optimistic locking ──────────────────────────

  describe('markAutoReleaseSubmitting', () => {
    it('claims the escrow and returns the record on first call', async () => {
      const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Camera',
        itemRef: 'camera-lock-001',
        amount: 250,
        trackingId: 'TRK-001',
        deliveredAt: pastDelivery,
      });

      const result = await escrowRepository.markAutoReleaseSubmitting(
        escrow.id,
      );

      expect(result).not.toBeNull();
      expect(result!.autoReleaseSubmittedAt).toBeInstanceOf(Date);
      expect(result!.id).toBe(escrow.id);
    });

    it('returns null when the lock is already held', async () => {
      const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Laptop',
        itemRef: 'laptop-lock-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
        deliveredAt: pastDelivery,
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
      const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Tablet',
        itemRef: 'tablet-lock-001',
        amount: 400,
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-3',
        trackingId: 'TRK-003',
        deliveredAt: pastDelivery,
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
      const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Camera',
        itemRef: 'camera-concurrent-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
        deliveredAt: pastDelivery,
      });

      contractService.submitAutoRelease.mockResolvedValue('tx-hash-1');

      // Run two concurrent workers
      await Promise.all([worker.run(), worker.run()]);

      // Only one submission should have occurred
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
        escrow.id,
        TEST_SOURCE_ADDRESS,
      );

      // Escrow state should be consistent
      const after = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(after!.state).toBe('RELEASED');
      expect(after!.autoReleaseTxHash).toBe('tx-hash-1');
    });

    it('releases the lock on failure so the next cycle can retry', async () => {
      const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Monitor',
        itemRef: 'monitor-fail-001',
        amount: 300,
        buyerAddress: 'buyer-4',
        vendorAddress: 'vendor-4',
        trackingId: 'TRK-004',
        deliveredAt: pastDelivery,
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
      expect(afterSecond!.state).toBe('RELEASED');
      expect(afterSecond!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('processes multiple escrows concurrently without collision', async () => {
      const escrow1 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Camera',
        itemRef: 'camera-multi-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
        shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
        deliveredAt: pastDelivery,
      });

      const escrow2 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Laptop',
        itemRef: 'laptop-multi-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
        shippedAt: new Date(Date.now() - 55 * 60 * 60 * 1000),
        deliveredAt: pastDelivery,
      });

      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-a')
        .mockResolvedValueOnce('tx-hash-b');

      await worker.run();

      // Both escrows should be released
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      expect(after1!.state).toBe('RELEASED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-a');

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('RELEASED');
      expect(after2!.autoReleaseTxHash).toBe('tx-hash-b');
    });

    it('skips escrows that are already auto-released', async () => {
      await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Headphones',
        itemRef: 'headphones-skip-001',
        amount: 80,
        buyerAddress: 'buyer-5',
        vendorAddress: 'vendor-5',
        trackingId: 'TRK-005',
        deliveredAt: pastDelivery,
        autoReleaseTxHash: 'existing-tx-hash',
      });

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });

    it('skips escrows with active disputes', async () => {
      const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Phone',
        itemRef: 'phone-dispute-001',
        amount: 800,
        buyerAddress: 'buyer-6',
        vendorAddress: 'vendor-6',
        trackingId: 'TRK-006',
        deliveredAt: pastDelivery,
      });

      await prisma.dispute.create({
        data: {
          escrowId: escrow.id,
          reason: 'ITEM_NOT_AS_DESCRIBED',
          description: 'Phone has defects',
          status: 'OPEN',
        },
      });

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });
  });
});
