import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { AutoReleaseService } from '../../src/escrow/auto-release.service';
import { ContractService } from '../../src/stellar/contract.service';
import { CacheService } from '../../src/cache/cache.service';

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
  let service: AutoReleaseService;

  const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        EscrowRepository,
        AutoReleaseService,
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
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    escrowRepository = moduleRef.get(EscrowRepository);
    contractService =
      moduleRef.get<jest.Mocked<ContractService>>(ContractService);
    service = moduleRef.get(AutoReleaseService);

    await prisma.reset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.reset();
  });

  // ── markAutoReleaseSubmitting optimistic locking ──────────────────────────

  describe('markAutoReleaseSubmitting', () => {
    it('claims the escrow and returns the record on first call', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Camera',
          itemRef: 'camera-lock-001',
          amount: 250,
          currency: 'USDC',
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          state: 'SHIPPED',
          trackingId: 'TRK-001',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
      });

      const result = await escrowRepository.markAutoReleaseSubmitting(
        escrow.id,
      );

      expect(result).not.toBeNull();
      expect(result!.autoReleaseSubmittedAt).toBeInstanceOf(Date);
      expect(result!.id).toBe(escrow.id);
    });

    it('returns null when the lock is already held', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Laptop',
          itemRef: 'laptop-lock-001',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-002',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
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
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Tablet',
          itemRef: 'tablet-lock-001',
          amount: 400,
          currency: 'USDC',
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          state: 'SHIPPED',
          trackingId: 'TRK-003',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
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

  // ── Concurrent auto-release via AutoReleaseService ────────────────────────

  describe('concurrent AutoReleaseService.run()', () => {
    it('only submits one transaction when two workers race on the same escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Camera',
          itemRef: 'camera-concurrent-001',
          amount: 250,
          currency: 'USDC',
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          state: 'SHIPPED',
          trackingId: 'TRK-001',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
      });

      contractService.submitAutoRelease.mockResolvedValue('tx-hash-1');

      // Run two concurrent workers
      await Promise.all([service.run(), service.run()]);

      // Only one submission should have occurred
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(escrow.id);

      // Escrow state should be consistent
      const after = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(after!.state).toBe('RELEASED');
      expect(after!.autoReleaseTxHash).toBe('tx-hash-1');
    });

    it('releases the lock on failure so the next cycle can retry', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Monitor',
          itemRef: 'monitor-fail-001',
          amount: 300,
          currency: 'USDC',
          buyerAddress: 'buyer-4',
          vendorAddress: 'vendor-4',
          state: 'SHIPPED',
          trackingId: 'TRK-004',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
      });

      // First call fails, second succeeds
      contractService.submitAutoRelease
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce('tx-hash-2');

      // First run: fails and releases lock
      await service.run();

      const afterFirst = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterFirst!.state).toBe('SHIPPED');
      expect(afterFirst!.autoReleaseSubmittedAt).toBeNull();

      // Second run: retries and succeeds
      await service.run();

      const afterSecond = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterSecond!.state).toBe('RELEASED');
      expect(afterSecond!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('processes multiple escrows concurrently without collision', async () => {
      const escrow1 = await prisma.escrow.create({
        data: {
          itemName: 'Camera',
          itemRef: 'camera-multi-001',
          amount: 250,
          currency: 'USDC',
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          state: 'SHIPPED',
          trackingId: 'TRK-001',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
      });

      const escrow2 = await prisma.escrow.create({
        data: {
          itemName: 'Laptop',
          itemRef: 'laptop-multi-001',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-002',
          shippedAt: new Date(Date.now() - 55 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
      });

      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-a')
        .mockResolvedValueOnce('tx-hash-b');

      await service.run();

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
      await prisma.escrow.create({
        data: {
          itemName: 'Headphones',
          itemRef: 'headphones-skip-001',
          amount: 80,
          currency: 'USDC',
          buyerAddress: 'buyer-5',
          vendorAddress: 'vendor-5',
          state: 'SHIPPED',
          trackingId: 'TRK-005',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
          autoReleaseTxHash: 'existing-tx-hash',
        },
      });

      await service.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });

    it('skips escrows with active disputes', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Phone',
          itemRef: 'phone-dispute-001',
          amount: 800,
          currency: 'USDC',
          buyerAddress: 'buyer-6',
          vendorAddress: 'vendor-6',
          state: 'SHIPPED',
          trackingId: 'TRK-006',
          shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
          deliveredAt: pastDelivery,
          deliveryRecordedAt: pastDelivery,
        },
      });

      await prisma.dispute.create({
        data: {
          escrowId: escrow.id,
          reason: 'ITEM_NOT_AS_DESCRIBED',
          description: 'Phone has defects',
          status: 'OPEN',
        },
      });

      await service.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });
  });
});
