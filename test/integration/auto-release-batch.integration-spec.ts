/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { ContractService } from '../../src/stellar/contract.service';
import { CacheService } from '../../src/cache/cache.service';

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
  let escrowRepository: EscrowRepository;
  let disputeRepository: DisputeRepository;
  let contractService: jest.Mocked<ContractService>;
  let worker: AutoReleaseWorker;

  const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

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
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    escrowRepository = moduleRef.get(EscrowRepository);
    disputeRepository = moduleRef.get(DisputeRepository);
    contractService = moduleRef.get<jest.Mocked<ContractService>>(ContractService);
    worker = moduleRef.get(AutoReleaseWorker);

    await prisma.reset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  describe('Mixed success/failure batch processing', () => {
    it('processes all escrows independently when middle escrow fails', async () => {
      // Create three eligible escrows
      const escrow1 = await prisma.escrow.create({
        data: {
          itemName: 'Camera',
          itemRef: 'camera-batch-001',
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
          itemRef: 'laptop-batch-001',
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

      const escrow3 = await prisma.escrow.create({
        data: {
          itemName: 'Phone',
          itemRef: 'phone-batch-001',
          amount: 800,
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

      // Second escrow fails, first and third succeed
      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce('tx-hash-3');

      await worker.run();

      // All three should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(3);

      // Check final states
      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      expect(after1!.state).toBe('RELEASED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-1');

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('SHIPPED');
      expect(after2!.autoReleaseTxHash).toBeNull();

      const after3 = await prisma.escrow.findUnique({
        where: { id: escrow3.id },
      });
      expect(after3!.state).toBe('RELEASED');
      expect(after3!.autoReleaseTxHash).toBe('tx-hash-3');
    });

    it('handles multiple failures in a batch without aborting', async () => {
      // Create four eligible escrows
      const escrows = await Promise.all([
        prisma.escrow.create({
          data: {
            itemName: 'Camera',
            itemRef: 'camera-multi-fail-001',
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
        }),
        prisma.escrow.create({
          data: {
            itemName: 'Laptop',
            itemRef: 'laptop-multi-fail-001',
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
        }),
        prisma.escrow.create({
          data: {
            itemName: 'Phone',
            itemRef: 'phone-multi-fail-001',
            amount: 800,
            currency: 'USDC',
            buyerAddress: 'buyer-3',
            vendorAddress: 'vendor-3',
            state: 'SHIPPED',
            trackingId: 'TRK-003',
            shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
            deliveredAt: pastDelivery,
            deliveryRecordedAt: pastDelivery,
          },
        }),
        prisma.escrow.create({
          data: {
            itemName: 'Tablet',
            itemRef: 'tablet-multi-fail-001',
            amount: 600,
            currency: 'USDC',
            buyerAddress: 'buyer-4',
            vendorAddress: 'vendor-4',
            state: 'SHIPPED',
            trackingId: 'TRK-004',
            shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
            deliveredAt: pastDelivery,
            deliveryRecordedAt: pastDelivery,
          },
        }),
      ]);

      // Pattern: success, fail, fail, success
      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Insufficient balance'))
        .mockResolvedValueOnce('tx-hash-4');

      await worker.run();

      // All four should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(4);

      // Check final states
      const results = await Promise.all(
        escrows.map((e) =>
          prisma.escrow.findUnique({ where: { id: e.id } }),
        ),
      );

      expect(results[0]!.state).toBe('RELEASED');
      expect(results[0]!.autoReleaseTxHash).toBe('tx-hash-1');

      expect(results[1]!.state).toBe('SHIPPED');
      expect(results[1]!.autoReleaseTxHash).toBeNull();

      expect(results[2]!.state).toBe('SHIPPED');
      expect(results[2]!.autoReleaseTxHash).toBeNull();

      expect(results[3]!.state).toBe('RELEASED');
      expect(results[3]!.autoReleaseTxHash).toBe('tx-hash-4');
    });

    it('continues processing after first escrow fails', async () => {
      // Create two eligible escrows
      const escrow1 = await prisma.escrow.create({
        data: {
          itemName: 'Camera',
          itemRef: 'camera-first-fail-001',
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
          itemRef: 'laptop-first-fail-001',
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

      // First fails, second succeeds
      contractService.submitAutoRelease
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockResolvedValueOnce('tx-hash-2');

      await worker.run();

      // Both should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

      // Check final states
      const after1 = await prisma.escrow.findUnique({
        where: { id: escrow1.id },
      });
      expect(after1!.state).toBe('SHIPPED');
      expect(after1!.autoReleaseTxHash).toBeNull();

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('RELEASED');
      expect(after2!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('handles all escrows failing without corruption', async () => {
      // Create three eligible escrows
      const escrows = await Promise.all([
        prisma.escrow.create({
          data: {
            itemName: 'Camera',
            itemRef: 'camera-all-fail-001',
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
        }),
        prisma.escrow.create({
          data: {
            itemName: 'Laptop',
            itemRef: 'laptop-all-fail-001',
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
        }),
        prisma.escrow.create({
          data: {
            itemName: 'Phone',
            itemRef: 'phone-all-fail-001',
            amount: 800,
            currency: 'USDC',
            buyerAddress: 'buyer-3',
            vendorAddress: 'vendor-3',
            state: 'SHIPPED',
            trackingId: 'TRK-003',
            shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
            deliveredAt: pastDelivery,
            deliveryRecordedAt: pastDelivery,
          },
        }),
      ]);

      // All fail with service unavailable
      contractService.submitAutoRelease.mockRejectedValue(
        new Error('Service unavailable'),
      );

      await worker.run();

      // All should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(3);

      // All should remain in SHIPPED state
      const results = await Promise.all(
        escrows.map((e) =>
          prisma.escrow.findUnique({ where: { id: e.id } }),
        ),
      );

      results.forEach((result) => {
        expect(result!.state).toBe('SHIPPED');
        expect(result!.autoReleaseTxHash).toBeNull();
      });
    });

    it('logs detailed failure information for each failed escrow', async () => {
      const loggerErrorSpy = jest.spyOn(worker['logger'], 'error');
      const loggerLogSpy = jest.spyOn(worker['logger'], 'log');
      const loggerWarnSpy = jest.spyOn(worker['logger'], 'warn');

      // Create two eligible escrows
      await Promise.all([
        prisma.escrow.create({
          data: {
            itemName: 'Camera',
            itemRef: 'camera-log-001',
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
        }),
        prisma.escrow.create({
          data: {
            itemName: 'Laptop',
            itemRef: 'laptop-log-001',
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
        }),
      ]);

      // First succeeds, second fails
      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockRejectedValueOnce(new Error('Connection refused'));

      await worker.run();

      // Verify batch summary log
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Processing batch of 2 eligible escrow(s) for auto-release',
      );

      // Verify error log for failed escrow
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection refused'),
        expect.any(String),
      );

      // Verify summary with counts
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Batch complete: 1 succeeded, 1 failed out of 2 total',
      );

      // Verify failed escrows list
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed escrows:'),
      );
    });

    it('processes successfully after retrying failed escrows', async () => {
      // Create one eligible escrow
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Camera',
          itemRef: 'camera-retry-001',
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

      // First run fails
      contractService.submitAutoRelease.mockRejectedValueOnce(
        new Error('Temporary network error'),
      );

      await worker.run();

      // Verify first attempt failed
      let afterFirst = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterFirst!.state).toBe('SHIPPED');
      expect(afterFirst!.autoReleaseTxHash).toBeNull();

      // Second run succeeds
      contractService.submitAutoRelease.mockResolvedValueOnce('tx-hash-1');

      await worker.run();

      // Verify retry succeeded
      let afterSecond = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterSecond!.state).toBe('RELEASED');
      expect(afterSecond!.autoReleaseTxHash).toBe('tx-hash-1');
    });
  });
});
