import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
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
  let contractService: jest.Mocked<ContractService>;
  let worker: AutoReleaseWorker;

  const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        EscrowRepository,
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
    contractService =
      moduleRef.get<jest.Mocked<ContractService>>(ContractService);
    worker = moduleRef.get(AutoReleaseWorker);

    await prisma.reset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  /**
   * Helper: create an escrow in DELIVERED state via markDelivered.
   * Ensures fixtures can only represent states the app itself can produce.
   */
  async function createEligibleEscrow(itemRef: string, itemName: string) {
    const escrow = await prisma.escrow.create({
      data: {
        itemName,
        itemRef,
        amount: 250,
        currency: 'USDC',
        buyerAddress: `buyer-${itemRef}`,
        vendorAddress: `vendor-${itemRef}`,
        state: 'CREATED',
        trackingId: `TRK-${itemRef}`,
      },
    });
    return escrowRepository.markDelivered(escrow.id, pastDelivery);
  }

  describe('Mixed success/failure batch processing', () => {
    it('processes all escrows independently when middle escrow fails', async () => {
      // Create three eligible escrows
      const escrow1 = await createEligibleEscrow('camera-batch-001', 'Camera');
      const escrow2 = await createEligibleEscrow('laptop-batch-001', 'Laptop');
      const escrow3 = await createEligibleEscrow('phone-batch-001', 'Phone');

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
      expect(after1!.state).toBe('COMPLETED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-1');

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('DELIVERED');
      expect(after2!.autoReleaseTxHash).toBeNull();

      const after3 = await prisma.escrow.findUnique({
        where: { id: escrow3.id },
      });
      expect(after3!.state).toBe('COMPLETED');
      expect(after3!.autoReleaseTxHash).toBe('tx-hash-3');
    });

    it('handles multiple failures in a batch without aborting', async () => {
      // Create four eligible escrows
      const escrows = await Promise.all([
        createEligibleEscrow('camera-multi-fail-001', 'Camera'),
        createEligibleEscrow('laptop-multi-fail-001', 'Laptop'),
        createEligibleEscrow('phone-multi-fail-001', 'Phone'),
        createEligibleEscrow('tablet-multi-fail-001', 'Tablet'),
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
        escrows.map((e) => prisma.escrow.findUnique({ where: { id: e.id } })),
      );

      expect(results[0]!.state).toBe('COMPLETED');
      expect(results[0]!.autoReleaseTxHash).toBe('tx-hash-1');

      expect(results[1]!.state).toBe('DELIVERED');
      expect(results[1]!.autoReleaseTxHash).toBeNull();

      expect(results[2]!.state).toBe('DELIVERED');
      expect(results[2]!.autoReleaseTxHash).toBeNull();

      expect(results[3]!.state).toBe('COMPLETED');
      expect(results[3]!.autoReleaseTxHash).toBe('tx-hash-4');
    });

    it('continues processing after first escrow fails', async () => {
      // Create two eligible escrows
      const escrow1 = await createEligibleEscrow('camera-first-fail-001', 'Camera');
      const escrow2 = await createEligibleEscrow('laptop-first-fail-001', 'Laptop');

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
      expect(after1!.state).toBe('DELIVERED');
      expect(after1!.autoReleaseTxHash).toBeNull();

      const after2 = await prisma.escrow.findUnique({
        where: { id: escrow2.id },
      });
      expect(after2!.state).toBe('COMPLETED');
      expect(after2!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('handles all escrows failing without corruption', async () => {
      // Create three eligible escrows
      const escrows = await Promise.all([
        createEligibleEscrow('camera-all-fail-001', 'Camera'),
        createEligibleEscrow('laptop-all-fail-001', 'Laptop'),
        createEligibleEscrow('phone-all-fail-001', 'Phone'),
      ]);

      // All fail with service unavailable
      contractService.submitAutoRelease.mockRejectedValue(
        new Error('Service unavailable'),
      );

      await worker.run();

      // All should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(3);

      // All should remain in DELIVERED state
      const results = await Promise.all(
        escrows.map((e) => prisma.escrow.findUnique({ where: { id: e.id } })),
      );

      results.forEach((result) => {
        expect(result!.state).toBe('DELIVERED');
        expect(result!.autoReleaseTxHash).toBeNull();
      });
    });

    it('logs detailed failure information for each failed escrow', async () => {
      const loggerErrorSpy = jest.spyOn(worker['logger'], 'error');
      const loggerLogSpy = jest.spyOn(worker['logger'], 'log');
      const loggerWarnSpy = jest.spyOn(worker['logger'], 'warn');

      // Create two eligible escrows
      await Promise.all([
        createEligibleEscrow('camera-log-001', 'Camera'),
        createEligibleEscrow('laptop-log-001', 'Laptop'),
      ]);

      // First succeeds, second fails
      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockRejectedValueOnce(new Error('Connection refused'));

      await worker.run();

      // Verify error log for failed escrow
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('auto_release.escrow_failed'),
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
      const escrow = await createEligibleEscrow('camera-retry-001', 'Camera');

      // First run fails
      contractService.submitAutoRelease.mockRejectedValueOnce(
        new Error('Temporary network error'),
      );

      await worker.run();

      // Verify first attempt failed
      const afterFirst = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterFirst!.state).toBe('DELIVERED');
      expect(afterFirst!.autoReleaseTxHash).toBeNull();

      // Second run succeeds
      contractService.submitAutoRelease.mockResolvedValueOnce('tx-hash-1');

      await worker.run();

      // Verify retry succeeded
      const afterSecond = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(afterSecond!.state).toBe('COMPLETED');
      expect(afterSecond!.autoReleaseTxHash).toBe('tx-hash-1');
    });
  });
});
