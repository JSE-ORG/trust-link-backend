import { Test } from '@nestjs/testing';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { TrackingPollWorker } from '../../src/workers/tracking-poll.worker';
import { ContractService } from '../../src/stellar/contract.service';

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * Builds a SHIPPED escrow row, overriding only the fields a test cares about.
 * Keeps each test focused on behaviour instead of fixture boilerplate.
 */
function buildEscrow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'escrow-1',
    itemName: 'Camera',
    amount: 250,
    currency: 'USDC',
    buyerAddress: 'buyer-1',
    vendorAddress: 'vendor-1',
    state: 'SHIPPED',
    trackingId: 'TRK-1',
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('TrackingPollWorker — interval scheduling & polling loop (issue #46)', () => {
  let worker: TrackingPollWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let logisticsService: jest.Mocked<LogisticsService>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    escrowRepository = {
      findShippedWithTracking: jest.fn(),
      markDelivered: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;
    logisticsService = {
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<LogisticsService>;
    contractService = {
      recordDelivery: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingPollWorker,
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: LogisticsService, useValue: logisticsService },
        { provide: ContractService, useValue: contractService },
      ],
    }).compile();

    worker = moduleRef.get(TrackingPollWorker);
  });

  describe('periodic scheduling (onModuleInit)', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      worker.onApplicationShutdown();
      jest.clearAllTimers();
      jest.useRealTimers();
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('does NOT schedule a timer while NODE_ENV is "test"', () => {
      process.env.NODE_ENV = 'test';
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      worker.onModuleInit();

      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('schedules a recurring 10-minute poll outside the test environment', () => {
      process.env.NODE_ENV = 'production';
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      worker.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        TEN_MINUTES,
      );
    });

    it('invokes run() on every interval tick', () => {
      process.env.NODE_ENV = 'production';
      const runSpy = jest.spyOn(worker, 'run').mockResolvedValue(undefined);

      worker.onModuleInit();
      expect(runSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(TEN_MINUTES);
      expect(runSpy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(TEN_MINUTES * 2);
      expect(runSpy).toHaveBeenCalledTimes(3);
    });

    it('stops polling after application shutdown clears the interval', () => {
      process.env.NODE_ENV = 'production';
      const runSpy = jest.spyOn(worker, 'run').mockResolvedValue(undefined);

      worker.onModuleInit();
      jest.advanceTimersByTime(TEN_MINUTES);
      expect(runSpy).toHaveBeenCalledTimes(1);

      worker.onApplicationShutdown();
      jest.advanceTimersByTime(TEN_MINUTES * 5);

      expect(runSpy).toHaveBeenCalledTimes(1);
    });

    it('is safe to shut down when no timer was ever scheduled', () => {
      expect(() => worker.onApplicationShutdown()).not.toThrow();
    });
  });

  describe('poll loop (run)', () => {
    it('polls the external carrier reference for every shipped escrow', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        buildEscrow({ id: 'escrow-1', trackingId: 'TRK-1' }),
        buildEscrow({ id: 'escrow-2', trackingId: 'TRK-2' }),
      ]);
      logisticsService.getStatus.mockResolvedValue({ status: 'IN_TRANSIT' });

      await worker.run();

      expect(logisticsService.getStatus).toHaveBeenCalledTimes(2);
      expect(logisticsService.getStatus).toHaveBeenCalledWith('TRK-1');
      expect(logisticsService.getStatus).toHaveBeenCalledWith('TRK-2');
    });

    it('does nothing when there are no shipments to poll', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([]);

      await worker.run();

      expect(logisticsService.getStatus).not.toHaveBeenCalled();
      expect(escrowRepository.markDelivered).not.toHaveBeenCalled();
      expect(contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('skips escrows that have no tracking reference', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        buildEscrow({ id: 'escrow-1', trackingId: null }),
      ]);

      await worker.run();

      expect(logisticsService.getStatus).not.toHaveBeenCalled();
      expect(escrowRepository.markDelivered).not.toHaveBeenCalled();
    });

    it('records delivery only when the carrier reports DELIVERED', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        buildEscrow({ id: 'escrow-1', trackingId: 'TRK-1' }),
      ]);
      logisticsService.getStatus.mockResolvedValue({ status: 'IN_TRANSIT' });

      await worker.run();

      expect(escrowRepository.markDelivered).not.toHaveBeenCalled();
      expect(contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('marks delivered and records the on-chain delivery for delivered shipments', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        buildEscrow({ id: 'escrow-1', trackingId: 'TRK-1' }),
      ]);
      logisticsService.getStatus.mockResolvedValue({ status: 'DELIVERED' });
      contractService.recordDelivery.mockResolvedValue('record-hash');

      await worker.run();

      expect(escrowRepository.markDelivered).toHaveBeenCalledWith(
        'escrow-1',
        expect.any(Date),
      );
      expect(contractService.recordDelivery).toHaveBeenCalledWith('escrow-1');
    });

    it('isolates a failed item so healthy shipments are still processed', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        buildEscrow({ id: 'escrow-fail', trackingId: 'TRK-FAIL' }),
        buildEscrow({ id: 'escrow-ok', trackingId: 'TRK-OK' }),
      ]);
      logisticsService.getStatus.mockImplementation((trackingId: string) => {
        if (trackingId === 'TRK-FAIL') {
          return Promise.reject(new Error('carrier timeout'));
        }
        return Promise.resolve({ status: 'DELIVERED' });
      });
      contractService.recordDelivery.mockResolvedValue('record-hash');

      await expect(worker.run()).resolves.toBeUndefined();

      // The healthy item still completes despite the earlier failure.
      expect(escrowRepository.markDelivered).toHaveBeenCalledTimes(1);
      expect(escrowRepository.markDelivered).toHaveBeenCalledWith(
        'escrow-ok',
        expect.any(Date),
      );
      expect(contractService.recordDelivery).toHaveBeenCalledWith('escrow-ok');
      // The failed item is never marked delivered.
      expect(escrowRepository.markDelivered).not.toHaveBeenCalledWith(
        'escrow-fail',
        expect.any(Date),
      );
    });

    it('logs and swallows carrier errors without rejecting the poll cycle', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        buildEscrow({ id: 'escrow-1', trackingId: 'TRK-1' }),
      ]);
      logisticsService.getStatus.mockRejectedValue(new Error('carrier down'));
      const loggerError = jest
        .spyOn(
          (worker as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(worker.run()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalled();
      expect(contractService.recordDelivery).not.toHaveBeenCalled();
    });
  });
});
