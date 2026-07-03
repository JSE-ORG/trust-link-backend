import { AutoReleaseWorker } from './auto-release.worker';
import { EscrowRepository } from '../escrow/escrow.repository';
import { DisputeRepository } from '../dispute/dispute.repository';
import { ContractService } from '../stellar/contract.service';
import { EscrowRecord, DisputeRecord } from '../prisma/prisma.service';

function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'escrow-1',
    itemName: 'Widget',
    itemRef: 'REF-001',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-addr',
    vendorAddress: 'vendor-addr',
    state: 'SHIPPED',
    trackingId: 'track-1',
    shippedAt: new Date('2024-01-01'),
    deliveredAt: new Date('2024-01-02'),
    deliveryRecordedAt: new Date('2024-01-02'),
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
  return {
    id: 'dispute-1',
    escrowId: 'escrow-1',
    reason: 'Item not received',
    description: '',
    evidenceUrls: [],
    status: 'OPEN',
    resolvedAt: null,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
    ...overrides,
  };
}

describe('AutoReleaseWorker', () => {
  let worker: AutoReleaseWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(() => {
    escrowRepository = {
      findAutoReleaseEligible: jest.fn(),
      markAutoReleaseCompleted: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    disputeRepository = {
      findByEscrow: jest.fn(),
    } as unknown as jest.Mocked<DisputeRepository>;

    contractService = {
      submitAutoRelease: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    worker = new AutoReleaseWorker(
      escrowRepository,
      disputeRepository,
      contractService,
    );
  });

  describe('run()', () => {
    it('completes without calling submitAutoRelease when there are no eligible escrows', async () => {
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([]);

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    });

    it('skips an escrow that has an open dispute', async () => {
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrow.mockResolvedValue(makeDispute());

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
      expect(escrowRepository.markAutoReleaseCompleted).not.toHaveBeenCalled();
    });

    it('skips an escrow whose state is COMPLETED', async () => {
      const escrow = makeEscrow({ state: 'COMPLETED' });
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
      expect(escrowRepository.markAutoReleaseCompleted).not.toHaveBeenCalled();
    });

    it('skips an escrow that already has an autoReleaseTxHash', async () => {
      const escrow = makeEscrow({ autoReleaseTxHash: 'existing-tx-hash' });
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      await worker.run();

      expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
      expect(escrowRepository.markAutoReleaseCompleted).not.toHaveBeenCalled();
    });

    it('calls markAutoReleaseCompleted with the txHash on success', async () => {
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrow.mockResolvedValue(null);
      contractService.submitAutoRelease.mockResolvedValue('tx-hash-abc');
      escrowRepository.markAutoReleaseCompleted.mockResolvedValue(
        makeEscrow({ state: 'COMPLETED', autoReleaseTxHash: 'tx-hash-abc' }),
      );

      await worker.run();

      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
        'escrow-1',
        expect.any(String),
      );
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledWith(
        'escrow-1',
        'tx-hash-abc',
      );
    });

    it('increments failureCount and records the error when submitAutoRelease throws, and still processes remaining escrows', async () => {
      const failingEscrow = makeEscrow({ id: 'escrow-fail' });
      const successEscrow = makeEscrow({ id: 'escrow-ok' });

      escrowRepository.findAutoReleaseEligible.mockResolvedValue([
        failingEscrow,
        successEscrow,
      ]);
      disputeRepository.findByEscrow.mockResolvedValue(null);
      contractService.submitAutoRelease
        .mockRejectedValueOnce(new Error('Stellar RPC timeout'))
        .mockResolvedValueOnce('tx-hash-ok');
      escrowRepository.markAutoReleaseCompleted.mockResolvedValue(
        makeEscrow({
          id: 'escrow-ok',
          state: 'COMPLETED',
          autoReleaseTxHash: 'tx-hash-ok',
        }),
      );

      await worker.run();

      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledTimes(
        1,
      );
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledWith(
        'escrow-ok',
        'tx-hash-ok',
      );
    });
  });

  describe('onModuleInit()', () => {
    it('does not start the interval when NODE_ENV is "test"', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      worker.onModuleInit();

      expect(setIntervalSpy).not.toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    });

    it('starts the interval when NODE_ENV is not "test"', () => {
      jest.useFakeTimers();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      worker.onModuleInit();

      expect(worker['timer']).not.toBeNull();

      worker.onApplicationShutdown();
      process.env.NODE_ENV = originalEnv;
      jest.useRealTimers();
    });
  });

  describe('onApplicationShutdown()', () => {
    it('clears the interval and sets the timer to null', () => {
      jest.useFakeTimers();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      worker.onModuleInit();
      expect(worker['timer']).not.toBeNull();

      worker.onApplicationShutdown();

      expect(worker['timer']).toBeNull();

      process.env.NODE_ENV = originalEnv;
      jest.useRealTimers();
    });

    it('does nothing when called without a running timer', () => {
      expect(() => worker.onApplicationShutdown()).not.toThrow();
      expect(worker['timer']).toBeNull();
    });
  });
});
