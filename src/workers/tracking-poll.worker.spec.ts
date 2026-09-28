/**
 * Unit tests for `TrackingPollWorker`.
 *
 * Issue #855 consolidated three spec files into this one, next to the source:
 * the guard-branch suite (#733), the poll-resilience suite (#11) and the
 * interval-scheduling suite (#46).
 *
 * Every distinct test is kept, and the suite is shared through one harness so
 * the worker is constructed the same way everywhere. All dependencies are
 * mocked; no real DB or HTTP calls are made.
 */

import { Logger } from '@nestjs/common';
import { TrackingPollWorker } from './tracking-poll.worker';
import { EscrowRepository } from '../escrow/escrow.repository';
import { LogisticsService } from '../logistics/logistics.service';
import { ContractService } from '../stellar/contract.service';
import { ConfigService } from '../config/config.service';
import { EscrowRecord } from '../prisma/prisma.service';
import { TEN_MINUTES_MS } from '../common/constants/time.constants';

/**
 * The admin address `record_delivery` must be called with: the contract does
 * `require_auth()` on the caller and rejects anyone who is not the admin.
 */
const ADMIN_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ── Fixture factory ──────────────────────────────────────────────────────────

function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'escrow-1',
    contractEscrowId: 42n,
    itemName: 'Widget',
    itemRef: 'REF-001',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-addr',
    vendorAddress: 'vendor-addr',
    state: 'SHIPPED',
    trackingId: 'TRACK-001',
    shippedAt: new Date('2024-01-01'),
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ── Shared harness ───────────────────────────────────────────────────────────

interface Harness {
  worker: TrackingPollWorker;
  escrowRepository: jest.Mocked<
    Pick<
      EscrowRepository,
      | 'findShippedWithTracking'
      | 'claimDelivery'
      | 'markDelivered'
      | 'clearDeliveryClaim'
    >
  >;
  logisticsService: jest.Mocked<Pick<LogisticsService, 'getStatus'>>;
  contractService: jest.Mocked<Pick<ContractService, 'recordDelivery'>>;
  configService: jest.Mocked<Pick<ConfigService, 'get'>>;
}

function createHarness(): Harness {
  const escrowRepository: Harness['escrowRepository'] = {
    findShippedWithTracking: jest.fn().mockResolvedValue([]),
    claimDelivery: jest.fn().mockResolvedValue(makeEscrow()),
    markDelivered: jest.fn().mockResolvedValue(makeEscrow()),
    clearDeliveryClaim: jest.fn().mockResolvedValue(makeEscrow()),
  };

  const logisticsService: Harness['logisticsService'] = {
    getStatus: jest.fn().mockResolvedValue({ status: 'DELIVERED', events: [] }),
  };

  const contractService: Harness['contractService'] = {
    recordDelivery: jest.fn().mockResolvedValue('record-hash'),
  };

  const configService: Harness['configService'] = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return process.env.NODE_ENV ?? 'test';
      if (key === 'ADMIN_ADDRESS') return ADMIN_ADDRESS;
      return undefined;
    }),
  };

  const worker = new TrackingPollWorker(
    escrowRepository as unknown as EscrowRepository,
    logisticsService as unknown as LogisticsService,
    contractService as unknown as ContractService,
    configService as unknown as ConfigService,
  );

  return {
    worker,
    escrowRepository,
    logisticsService,
    contractService,
    configService,
  };
}

/** The worker's own logger, for asserting on the structured events it emits. */
function loggerOf(worker: TrackingPollWorker): Logger {
  return (worker as unknown as { logger: Logger }).logger;
}

// ── Guard branches (#733) ─────────────────────────────────────────────────────

describe('TrackingPollWorker', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  afterEach(() => {
    // Several tests spy on the worker logger; restore so the patch does not
    // leak into the next test through the Logger prototype.
    jest.restoreAllMocks();
  });

  // ── Branch 1: !escrow.trackingId ─────────────────────────────────────────

  describe('run() — escrow with no trackingId (branch 1)', () => {
    it('skips the escrow without calling getStatus', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ trackingId: null }),
      ]);

      await h.worker.run();

      expect(h.logisticsService.getStatus).not.toHaveBeenCalled();
    });

    it('does not attempt to claim delivery when trackingId is absent', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ trackingId: null }),
      ]);

      await h.worker.run();

      expect(h.escrowRepository.claimDelivery).not.toHaveBeenCalled();
    });

    it('does not mark an escrow without a tracking reference as delivered', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ trackingId: null }),
      ]);

      await h.worker.run();

      expect(h.escrowRepository.markDelivered).not.toHaveBeenCalled();
    });
  });

  // ── Branch 2: escrow.contractEscrowId === null ────────────────────────────

  describe('run() — escrow not yet on chain (branch 2)', () => {
    it('skips an unmapped escrow without calling recordDelivery', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ contractEscrowId: null }),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });

      await h.worker.run();

      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('does not claim delivery for an unmapped escrow', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ contractEscrowId: null }),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });

      await h.worker.run();

      expect(h.escrowRepository.claimDelivery).not.toHaveBeenCalled();
    });

    it('logs a tracking_poll.unmapped_escrow event for the unmapped row', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ id: 'escrow-unmapped', contractEscrowId: null }),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();

      await h.worker.run();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('tracking_poll.unmapped_escrow'),
      );
    });

    it('continues to process subsequent escrows after skipping an unmapped one', async () => {
      const mappedEscrow = makeEscrow({
        id: 'escrow-mapped',
        contractEscrowId: 99n,
      });
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ contractEscrowId: null }),
        mappedEscrow,
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery.mockResolvedValue(mappedEscrow);

      await h.worker.run();

      expect(h.contractService.recordDelivery).toHaveBeenCalledWith(
        99n,
        ADMIN_ADDRESS,
      );
    });
  });

  // ── Branch 3: !claimed — claim race ──────────────────────────────────────

  describe('run() — claim race: another instance claimed first (branch 3)', () => {
    it('does not call recordDelivery when claimDelivery returns null', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery.mockResolvedValue(null); // lost the race

      await h.worker.run();

      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('does not call markDelivered when the claim is lost', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery.mockResolvedValue(null);

      await h.worker.run();

      expect(h.escrowRepository.markDelivered).not.toHaveBeenCalled();
    });

    it('continues processing remaining escrows after losing a claim', async () => {
      const raceEscrow = makeEscrow({ id: 'escrow-race' });
      const ownedEscrow = makeEscrow({
        id: 'escrow-owned',
        contractEscrowId: 7n,
      });

      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        raceEscrow,
        ownedEscrow,
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery
        .mockResolvedValueOnce(null) // lost for raceEscrow
        .mockResolvedValueOnce(ownedEscrow); // won for ownedEscrow

      await h.worker.run();

      expect(h.contractService.recordDelivery).toHaveBeenCalledTimes(1);
      expect(h.contractService.recordDelivery).toHaveBeenCalledWith(
        7n,
        ADMIN_ADDRESS,
      );
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe('run() — happy path', () => {
    it('calls recordDelivery and markDelivered when a DELIVERED escrow is claimed', async () => {
      const escrow = makeEscrow();
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery.mockResolvedValue(escrow);

      await h.worker.run();

      expect(h.escrowRepository.claimDelivery).toHaveBeenCalledWith('escrow-1');
      expect(h.contractService.recordDelivery).toHaveBeenCalledWith(
        42n,
        ADMIN_ADDRESS,
      );
      expect(h.escrowRepository.markDelivered).toHaveBeenCalledWith(
        'escrow-1',
        expect.any(Date),
      );
    });

    it('does not call recordDelivery when status is IN_TRANSIT', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'IN_TRANSIT',
        events: [],
      });

      await h.worker.run();

      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('records delivery only when the carrier reports DELIVERED', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'IN_TRANSIT',
        events: [],
      });

      await h.worker.run();

      expect(h.escrowRepository.markDelivered).not.toHaveBeenCalled();
      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('clears the delivery claim and rethrows when recordDelivery fails', async () => {
      const escrow = makeEscrow();
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery.mockResolvedValue(escrow);
      h.contractService.recordDelivery.mockRejectedValue(
        new Error('Stellar RPC timeout'),
      );

      // run() catches per-escrow errors internally — it should not throw
      await expect(h.worker.run()).resolves.not.toThrow();

      expect(h.escrowRepository.clearDeliveryClaim).toHaveBeenCalledWith(
        'escrow-1',
      );
    });

    it('leaves the escrow retryable when the contract call fails', async () => {
      const escrow = makeEscrow();
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      h.escrowRepository.claimDelivery.mockResolvedValue(escrow);
      h.contractService.recordDelivery.mockRejectedValue(
        new Error('contract timeout'),
      );

      await expect(h.worker.run()).resolves.toBeUndefined();

      // The claim must be cleared so the next poll cycle retries.
      expect(h.escrowRepository.clearDeliveryClaim).toHaveBeenCalledWith(
        'escrow-1',
      );
      // The escrow is NOT marked delivered, since the contract call failed.
      expect(h.escrowRepository.markDelivered).not.toHaveBeenCalled();
    });
  });

  // ── Poll loop (issue #11) ────────────────────────────────────────────────

  describe('run() — poll loop', () => {
    it('polls the external carrier reference for every shipped escrow', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ id: 'escrow-1', trackingId: 'TRK-1' }),
        makeEscrow({ id: 'escrow-2', trackingId: 'TRK-2' }),
      ]);
      h.logisticsService.getStatus.mockResolvedValue({
        status: 'IN_TRANSIT',
        events: [],
      });

      await h.worker.run();

      expect(h.logisticsService.getStatus).toHaveBeenCalledTimes(2);
      expect(h.logisticsService.getStatus).toHaveBeenCalledWith('TRK-1');
      expect(h.logisticsService.getStatus).toHaveBeenCalledWith('TRK-2');
    });

    it('does nothing when there are no shipments to poll', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([]);

      await h.worker.run();

      expect(h.logisticsService.getStatus).not.toHaveBeenCalled();
      expect(h.escrowRepository.markDelivered).not.toHaveBeenCalled();
      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('isolates a failed item so healthy shipments are still processed', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ id: 'escrow-fail', trackingId: 'TRK-FAIL' }),
        makeEscrow({ id: 'escrow-ok', trackingId: 'TRK-OK' }),
      ]);
      h.logisticsService.getStatus.mockImplementation((trackingId: string) => {
        if (trackingId === 'TRK-FAIL') {
          return Promise.reject(new Error('carrier timeout'));
        }
        return Promise.resolve({ status: 'DELIVERED', events: [] });
      });

      await expect(h.worker.run()).resolves.toBeUndefined();

      // The healthy item still completes despite the earlier failure.
      expect(h.escrowRepository.markDelivered).toHaveBeenCalledTimes(1);
      expect(h.escrowRepository.markDelivered).toHaveBeenCalledWith(
        'escrow-ok',
        expect.any(Date),
      );
      expect(h.contractService.recordDelivery).toHaveBeenCalledWith(
        42n,
        ADMIN_ADDRESS,
      );
      // The failed item is never marked delivered.
      expect(h.escrowRepository.markDelivered).not.toHaveBeenCalledWith(
        'escrow-fail',
        expect.any(Date),
      );
    });

    it('keeps polling resilient to carrier API failures', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      h.logisticsService.getStatus.mockRejectedValue(
        new Error('carrier down'),
      );

      await expect(h.worker.run()).resolves.toBeUndefined();
      expect(h.escrowRepository.claimDelivery).not.toHaveBeenCalled();
      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('logs and swallows carrier errors without rejecting the poll cycle', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      h.logisticsService.getStatus.mockRejectedValue(
        new Error('carrier down'),
      );
      const loggerError = jest
        .spyOn(loggerOf(h.worker), 'error')
        .mockImplementation(() => undefined);

      await expect(h.worker.run()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalled();
      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('logs a tracking_poll.escrow_failed event for a failing escrow', async () => {
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ id: 'escrow-bad', trackingId: 'TRK-BAD' }),
      ]);
      h.logisticsService.getStatus.mockRejectedValue(
        new Error('carrier down'),
      );
      const loggerError = jest
        .spyOn(loggerOf(h.worker), 'error')
        .mockImplementation(() => undefined);

      await h.worker.run();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('tracking_poll.escrow_failed'),
        expect.any(String),
      );
    });
  });

  // ── Top-level failure handling (issue #11) ───────────────────────────────

  describe('run() — top-level failures', () => {
    it('catches top-level poll failures so interval handlers do not reject', async () => {
      h.escrowRepository.findShippedWithTracking.mockRejectedValue(
        new Error('database unavailable'),
      );
      const loggerSpy = jest
        .spyOn(loggerOf(h.worker), 'error')
        .mockImplementation();

      await expect(h.worker.run()).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('tracking_poll.worker_failed'),
        expect.any(String),
      );
    });

    it('refuses to record delivery when ADMIN_ADDRESS is not configured', async () => {
      const escrow = makeEscrow();
      h.escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
      h.escrowRepository.claimDelivery.mockResolvedValue(escrow);
      h.configService.get.mockReturnValue(undefined);
      jest.spyOn(loggerOf(h.worker), 'error').mockImplementation();

      await h.worker.run();

      expect(h.contractService.recordDelivery).not.toHaveBeenCalled();
      // The claim is released so a later run with a configured address retries.
      expect(h.escrowRepository.clearDeliveryClaim).toHaveBeenCalledWith(
        'escrow-1',
      );
    });
  });
});

// ── Interval scheduling (issue #46) ──────────────────────────────────────────

describe('TrackingPollWorker — periodic scheduling (issue #46)', () => {
  let h: Harness;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    h = createHarness();
    jest.useFakeTimers();
  });

  afterEach(() => {
    h.worker.onApplicationShutdown();
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('does NOT schedule a timer while NODE_ENV is "test"', () => {
    process.env.NODE_ENV = 'test';
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    h.worker.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('schedules a recurring 10-minute poll outside the test environment', () => {
    process.env.NODE_ENV = 'production';
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    h.worker.onModuleInit();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      TEN_MINUTES_MS,
    );
  });

  it('invokes run() on every interval tick', () => {
    process.env.NODE_ENV = 'production';
    const runSpy = jest.spyOn(h.worker, 'run').mockResolvedValue(undefined);

    h.worker.onModuleInit();
    expect(runSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(TEN_MINUTES_MS);
    expect(runSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(TEN_MINUTES_MS * 2);
    expect(runSpy).toHaveBeenCalledTimes(3);
  });

  it('stops polling after application shutdown clears the interval', () => {
    process.env.NODE_ENV = 'production';
    const runSpy = jest.spyOn(h.worker, 'run').mockResolvedValue(undefined);

    h.worker.onModuleInit();
    jest.advanceTimersByTime(TEN_MINUTES_MS);
    expect(runSpy).toHaveBeenCalledTimes(1);

    h.worker.onApplicationShutdown();
    jest.advanceTimersByTime(TEN_MINUTES_MS * 5);

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('is safe to shut down when no timer was ever scheduled', () => {
    expect(() => h.worker.onApplicationShutdown()).not.toThrow();
  });
});

/**
 * Issue #840 — `TrackingPollWorker` called `run()` from a 10-minute
 * `setInterval` with no check for a run still in progress, and the tracking
 * loop calls the logistics API once per shipped escrow with a 10s timeout
 * each. A slow provider makes a run outlast the interval, so the next tick
 * started a second overlapping cycle.
 *
 * `SorobanPollerService.poll()` already guards this with a `polling` flag.
 */
describe('TrackingPollWorker reentrancy guard (#840)', () => {
  let h: Harness;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    h = createHarness();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips a tick that starts while a run is in progress', async () => {
    // A provider call that never settles: the first run is still going when
    // the second tick arrives.
    let releaseFirst: () => void = () => undefined;
    h.logisticsService.getStatus.mockReturnValue(
      new Promise((resolve) => {
        releaseFirst = () => resolve({ status: 'DELIVERED', events: [] });
      }),
    );
    h.escrowRepository.findShippedWithTracking.mockResolvedValue([
      makeEscrow({ id: 'escrow-slow', trackingId: 'TRACK-SLOW' }),
    ]);

    const first = h.worker.run();
    // Let the first run reach the in-flight provider call.
    await Promise.resolve();
    await Promise.resolve();

    const second = await h.worker.run();

    releaseFirst();
    await first;

    // The skipped tick did no work and said so.
    expect(second).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('still in progress'),
    );
    expect(h.logisticsService.getStatus).toHaveBeenCalledTimes(1);
  });

  it('does not re-query shipments on the skipped tick', async () => {
    let release: () => void = () => undefined;
    h.escrowRepository.findShippedWithTracking.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([makeEscrow()]);
      }),
    );

    const first = h.worker.run();
    await Promise.resolve();
    await h.worker.run();
    release();
    await first;

    expect(h.escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(1);
  });

  it('does not submit a contract call from the skipped tick', async () => {
    let release: () => void = () => undefined;
    h.escrowRepository.findShippedWithTracking.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([makeEscrow()]);
      }),
    );

    const first = h.worker.run();
    await Promise.resolve();
    await h.worker.run();
    release();
    await first;

    // Only the first run's own single delivery is submitted.
    expect(h.contractService.recordDelivery).toHaveBeenCalledTimes(1);
  });

  it('runs normally again once the previous run finishes', async () => {
    await h.worker.run();
    const callsAfterFirst =
      h.escrowRepository.findShippedWithTracking.mock.calls.length;

    await h.worker.run();

    expect(h.escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(
      callsAfterFirst + 1,
    );
  });

  it('clears the flag when a run throws, so later ticks still work', async () => {
    h.escrowRepository.findShippedWithTracking.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await h.worker.run();
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('still in progress'),
    );

    h.escrowRepository.findShippedWithTracking.mockResolvedValue([]);
    await h.worker.run();

    expect(h.escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(2);
  });

  it('resolves rather than rejecting when a run throws', async () => {
    h.escrowRepository.findShippedWithTracking.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(h.worker.run()).resolves.toBeUndefined();
  });

  it('clears the flag when a per-escrow failure throws out of the loop', async () => {
    // A throwing logistics call is caught per-escrow, so the cycle still
    // completes; the flag must be released.
    h.logisticsService.getStatus.mockRejectedValue(
      new Error('logistics down'),
    );
    h.escrowRepository.findShippedWithTracking.mockResolvedValue([
      makeEscrow(),
    ]);

    await h.worker.run();
    await h.worker.run();

    expect(h.logisticsService.getStatus).toHaveBeenCalledTimes(2);
  });

  it('does not overlap after many rapid ticks', async () => {
    let release: () => void = () => undefined;
    h.escrowRepository.findShippedWithTracking.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );

    const first = h.worker.run();
    await Promise.resolve();
    // Five ticks land while the first is still in flight.
    for (let i = 0; i < 5; i++) {
      await h.worker.run();
    }
    release();
    await first;

    expect(h.escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(1);
  });
});
