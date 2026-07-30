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
  overrides: {
    itemName: string;
    itemRef: string;
    amount: number;
    buyerAddress: string;
    vendorAddress: string;
    trackingId: string;
    deliveredAt: Date;
  },
) {
  const base = await prisma.escrow.create({
    data: {
      itemName: overrides.itemName,
      itemRef: overrides.itemRef,
      amount: overrides.amount,
      currency: 'USDC',
      buyerAddress: overrides.buyerAddress,
      vendorAddress: overrides.vendorAddress,
      state: 'SHIPPED',
      trackingId: overrides.trackingId,
      shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
    },
  });
  await repository.markDelivered(base.id, overrides.deliveredAt);
  return base.id;
}

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
  });

  describe('Mixed success/failure batch processing', () => {
    it('processes all escrows independently when middle escrow fails', async () => {
      // Create three eligible escrows
      const id1 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Camera',
        itemRef: 'camera-batch-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
        deliveredAt: pastDelivery,
      });

      const id2 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Laptop',
        itemRef: 'laptop-batch-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
        deliveredAt: pastDelivery,
      });

      const id3 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Phone',
        itemRef: 'phone-batch-001',
        amount: 800,
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-3',
        trackingId: 'TRK-003',
        deliveredAt: pastDelivery,
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
      const after1 = await prisma.escrow.findUnique({ where: { id: id1 } });
      expect(after1!.state).toBe('RELEASED');
      expect(after1!.autoReleaseTxHash).toBe('tx-hash-1');

      const after2 = await prisma.escrow.findUnique({ where: { id: id2 } });
      expect(after2!.state).toBe('DELIVERED');
      expect(after2!.autoReleaseTxHash).toBeNull();

      const after3 = await prisma.escrow.findUnique({ where: { id: id3 } });
      expect(after3!.state).toBe('RELEASED');
      expect(after3!.autoReleaseTxHash).toBe('tx-hash-3');
    });

    it('handles multiple failures in a batch without aborting', async () => {
      // Create four eligible escrows
      const ids = await Promise.all([
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Camera',
          itemRef: 'camera-multi-fail-001',
          amount: 250,
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          trackingId: 'TRK-001',
          deliveredAt: pastDelivery,
        }),
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Laptop',
          itemRef: 'laptop-multi-fail-001',
          amount: 1200,
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          trackingId: 'TRK-002',
          deliveredAt: pastDelivery,
        }),
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Phone',
          itemRef: 'phone-multi-fail-001',
          amount: 800,
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          trackingId: 'TRK-003',
          deliveredAt: pastDelivery,
        }),
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Tablet',
          itemRef: 'tablet-multi-fail-001',
          amount: 600,
          buyerAddress: 'buyer-4',
          vendorAddress: 'vendor-4',
          trackingId: 'TRK-004',
          deliveredAt: pastDelivery,
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
        ids.map((id) => prisma.escrow.findUnique({ where: { id } })),
      );

      expect(results[0]!.state).toBe('RELEASED');
      expect(results[0]!.autoReleaseTxHash).toBe('tx-hash-1');

      expect(results[1]!.state).toBe('DELIVERED');
      expect(results[1]!.autoReleaseTxHash).toBeNull();

      expect(results[2]!.state).toBe('DELIVERED');
      expect(results[2]!.autoReleaseTxHash).toBeNull();

      expect(results[3]!.state).toBe('RELEASED');
      expect(results[3]!.autoReleaseTxHash).toBe('tx-hash-4');
    });

    it('continues processing after first escrow fails', async () => {
      // Create two eligible escrows
      const id1 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Camera',
        itemRef: 'camera-first-fail-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
        deliveredAt: pastDelivery,
      });

      const id2 = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Laptop',
        itemRef: 'laptop-first-fail-001',
        amount: 1200,
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-002',
        deliveredAt: pastDelivery,
      });

      // First fails, second succeeds
      contractService.submitAutoRelease
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockResolvedValueOnce('tx-hash-2');

      await worker.run();

      // Both should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

      // Check final states
      const after1 = await prisma.escrow.findUnique({ where: { id: id1 } });
      expect(after1!.state).toBe('DELIVERED');
      expect(after1!.autoReleaseTxHash).toBeNull();

      const after2 = await prisma.escrow.findUnique({ where: { id: id2 } });
      expect(after2!.state).toBe('RELEASED');
      expect(after2!.autoReleaseTxHash).toBe('tx-hash-2');
    });

    it('handles all escrows failing without corruption', async () => {
      // Create three eligible escrows
      const ids = await Promise.all([
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Camera',
          itemRef: 'camera-all-fail-001',
          amount: 250,
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          trackingId: 'TRK-001',
          deliveredAt: pastDelivery,
        }),
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Laptop',
          itemRef: 'laptop-all-fail-001',
          amount: 1200,
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          trackingId: 'TRK-002',
          deliveredAt: pastDelivery,
        }),
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Phone',
          itemRef: 'phone-all-fail-001',
          amount: 800,
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          trackingId: 'TRK-003',
          deliveredAt: pastDelivery,
        }),
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
        ids.map((id) => prisma.escrow.findUnique({ where: { id } })),
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
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Camera',
          itemRef: 'camera-log-001',
          amount: 250,
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          trackingId: 'TRK-001',
          deliveredAt: pastDelivery,
        }),
        createDeliveredEscrow(prisma, escrowRepository, {
          itemName: 'Laptop',
          itemRef: 'laptop-log-001',
          amount: 1200,
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          trackingId: 'TRK-002',
          deliveredAt: pastDelivery,
        }),
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
      const id = await createDeliveredEscrow(prisma, escrowRepository, {
        itemName: 'Camera',
        itemRef: 'camera-retry-001',
        amount: 250,
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-001',
        deliveredAt: pastDelivery,
      });

      // First run fails
      contractService.submitAutoRelease.mockRejectedValueOnce(
        new Error('Temporary network error'),
      );

      await worker.run();

      // Verify first attempt failed
      const afterFirst = await prisma.escrow.findUnique({ where: { id } });
      expect(afterFirst!.state).toBe('DELIVERED');
      expect(afterFirst!.autoReleaseTxHash).toBeNull();

      // Second run succeeds
      contractService.submitAutoRelease.mockResolvedValueOnce('tx-hash-1');

      await worker.run();

      // Verify retry succeeded
      const afterSecond = await prisma.escrow.findUnique({ where: { id } });
      expect(afterSecond!.state).toBe('RELEASED');
      expect(afterSecond!.autoReleaseTxHash).toBe('tx-hash-1');
    });
  });
});
