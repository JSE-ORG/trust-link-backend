/**
 * Unit tests for TrackingPollWorker — covering the three uncovered guards
 * identified in issue #733:
 *
 *  1. if (!escrow.trackingId)           — escrow has no address to poll
 *  2. if (escrow.contractEscrowId === null) — escrow not yet on chain
 *  3. if (!claimed)                     — another instance claimed the job first
 *
 * All dependencies are mocked; no real DB or HTTP calls are made.
 */

import { Logger } from '@nestjs/common';
import { TrackingPollWorker } from './tracking-poll.worker';
import { EscrowRepository } from '../escrow/escrow.repository';
import { LogisticsService } from '../logistics/logistics.service';
import { ContractService } from '../stellar/contract.service';
import { ConfigService } from '../config/config.service';
import { EscrowRecord } from '../prisma/prisma.service';

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

// ── Test suite ────────────────────────────────────────────────────────────────

describe('TrackingPollWorker', () => {
  let worker: TrackingPollWorker;
  let escrowRepository: jest.Mocked<
    Pick<
      EscrowRepository,
      | 'findShippedWithTracking'
      | 'claimDelivery'
      | 'markDelivered'
      | 'clearDeliveryClaim'
    >
  >;
  let logisticsService: jest.Mocked<Pick<LogisticsService, 'getStatus'>>;
  let contractService: jest.Mocked<Pick<ContractService, 'recordDelivery'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(() => {
    escrowRepository = {
      findShippedWithTracking: jest.fn().mockResolvedValue([]),
      claimDelivery: jest.fn().mockResolvedValue(makeEscrow()),
      markDelivered: jest.fn().mockResolvedValue(makeEscrow()),
      clearDeliveryClaim: jest.fn().mockResolvedValue(makeEscrow()),
    };

    logisticsService = {
      getStatus: jest
        .fn()
        .mockResolvedValue({ status: 'DELIVERED', events: [] }),
    };

    contractService = {
      recordDelivery: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'ADMIN_ADDRESS') return 'GADMIN-ADDR';
        return undefined;
      }),
    };

    worker = new TrackingPollWorker(
      escrowRepository as unknown as EscrowRepository,
      logisticsService as unknown as LogisticsService,
      contractService as unknown as ContractService,
      configService as unknown as ConfigService,
    );
  });

  // ── Branch 1: !escrow.trackingId ─────────────────────────────────────────

  describe('run() — escrow with no trackingId (branch 1)', () => {
    it('skips the escrow without calling getStatus', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ trackingId: null }),
      ]);

      await worker.run();

      expect(logisticsService.getStatus).not.toHaveBeenCalled();
    });

    it('does not attempt to claim delivery when trackingId is absent', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ trackingId: null }),
      ]);

      await worker.run();

      expect(escrowRepository.claimDelivery).not.toHaveBeenCalled();
    });
  });

  // ── Branch 2: escrow.contractEscrowId === null ────────────────────────────

  describe('run() — escrow not yet on chain (branch 2)', () => {
    it('skips an unmapped escrow without calling recordDelivery', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ contractEscrowId: null }),
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });

      await worker.run();

      expect(contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('does not claim delivery for an unmapped escrow', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ contractEscrowId: null }),
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });

      await worker.run();

      expect(escrowRepository.claimDelivery).not.toHaveBeenCalled();
    });

    it('continues to process subsequent escrows after skipping an unmapped one', async () => {
      const mappedEscrow = makeEscrow({
        id: 'escrow-mapped',
        contractEscrowId: 99n,
      });
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow({ contractEscrowId: null }),
        mappedEscrow,
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      escrowRepository.claimDelivery.mockResolvedValue(mappedEscrow);

      await worker.run();

      expect(contractService.recordDelivery).toHaveBeenCalledWith(
        99n,
        'GADMIN-ADDR',
      );
    });
  });

  // ── Branch 3: !claimed — claim race ──────────────────────────────────────

  describe('run() — claim race: another instance claimed first (branch 3)', () => {
    it('does not call recordDelivery when claimDelivery returns null', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      escrowRepository.claimDelivery.mockResolvedValue(null); // lost the race

      await worker.run();

      expect(contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('does not call markDelivered when the claim is lost', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      escrowRepository.claimDelivery.mockResolvedValue(null);

      await worker.run();

      expect(escrowRepository.markDelivered).not.toHaveBeenCalled();
    });

    it('continues processing remaining escrows after losing a claim', async () => {
      const raceEscrow = makeEscrow({ id: 'escrow-race' });
      const ownedEscrow = makeEscrow({
        id: 'escrow-owned',
        contractEscrowId: 7n,
      });

      escrowRepository.findShippedWithTracking.mockResolvedValue([
        raceEscrow,
        ownedEscrow,
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      escrowRepository.claimDelivery
        .mockResolvedValueOnce(null) // lost for raceEscrow
        .mockResolvedValueOnce(ownedEscrow); // won for ownedEscrow

      await worker.run();

      expect(contractService.recordDelivery).toHaveBeenCalledTimes(1);
      expect(contractService.recordDelivery).toHaveBeenCalledWith(
        7n,
        'GADMIN-ADDR',
      );
    });
  });

  // ── Happy path — ensures mocks are wired correctly ────────────────────────

  describe('run() — happy path', () => {
    it('calls recordDelivery and markDelivered when a DELIVERED escrow is claimed', async () => {
      const escrow = makeEscrow();
      escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      escrowRepository.claimDelivery.mockResolvedValue(escrow);

      await worker.run();

      expect(contractService.recordDelivery).toHaveBeenCalledWith(
        42n,
        'GADMIN-ADDR',
      );
      expect(escrowRepository.markDelivered).toHaveBeenCalledWith(
        'escrow-1',
        expect.any(Date),
      );
    });

    it('does not call recordDelivery when status is IN_TRANSIT', async () => {
      escrowRepository.findShippedWithTracking.mockResolvedValue([
        makeEscrow(),
      ]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'IN_TRANSIT',
        events: [],
      });

      await worker.run();

      expect(contractService.recordDelivery).not.toHaveBeenCalled();
    });

    it('clears the delivery claim and rethrows when recordDelivery fails', async () => {
      const escrow = makeEscrow();
      escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
      logisticsService.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        events: [],
      });
      escrowRepository.claimDelivery.mockResolvedValue(escrow);
      contractService.recordDelivery.mockRejectedValue(
        new Error('Stellar RPC timeout'),
      );

      // run() catches per-escrow errors internally — it should not throw
      await expect(worker.run()).resolves.not.toThrow();

      expect(escrowRepository.clearDeliveryClaim).toHaveBeenCalledWith(
        'escrow-1',
      );
    });
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
  let worker: TrackingPollWorker;
  let escrowRepository: jest.Mocked<
    Pick<
      EscrowRepository,
      | 'findShippedWithTracking'
      | 'claimDelivery'
      | 'markDelivered'
      | 'clearDeliveryClaim'
    >
  >;
  let logisticsService: jest.Mocked<Pick<LogisticsService, 'getStatus'>>;
  let contractService: jest.Mocked<Pick<ContractService, 'recordDelivery'>>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    escrowRepository = {
      findShippedWithTracking: jest.fn().mockResolvedValue([]),
      claimDelivery: jest.fn().mockResolvedValue(makeEscrow()),
      markDelivered: jest.fn().mockResolvedValue(makeEscrow()),
      clearDeliveryClaim: jest.fn().mockResolvedValue(makeEscrow()),
    };
    logisticsService = {
      getStatus: jest.fn().mockResolvedValue({ status: 'DELIVERED', events: [] }),
    };
    contractService = {
      recordDelivery: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'ADMIN_ADDRESS') return 'GADMIN-ADDR';
        return undefined;
      }),
    };

    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    worker = new TrackingPollWorker(
      escrowRepository as unknown as EscrowRepository,
      logisticsService as unknown as LogisticsService,
      contractService as unknown as ContractService,
      configService as unknown as ConfigService,
    );
    jest
      .spyOn(worker, 'sleep' as keyof TrackingPollWorker)
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips a tick that starts while a run is in progress', async () => {
    // A provider call that never settles: the first run is still going when
    // the second tick arrives.
    let releaseFirst: () => void = () => undefined;
    logisticsService.getStatus.mockReturnValue(
      new Promise((resolve) => {
        releaseFirst = () => resolve({ status: 'DELIVERED', events: [] });
      }),
    );
    escrowRepository.findShippedWithTracking.mockResolvedValue([
      makeEscrow({ id: 'escrow-slow', trackingId: 'TRACK-SLOW' }),
    ]);

    const first = worker.run();
    // Let the first run reach the in-flight provider call.
    await Promise.resolve();
    await Promise.resolve();

    const second = await worker.run();

    releaseFirst();
    await first;

    // The skipped tick did no work and said so.
    expect(second).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('still in progress'),
    );
    expect(logisticsService.getStatus).toHaveBeenCalledTimes(1);
  });

  it('does not re-query shipments on the skipped tick', async () => {
    let release: () => void = () => undefined;
    escrowRepository.findShippedWithTracking.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([makeEscrow()]);
      }),
    );

    const first = worker.run();
    await Promise.resolve();
    await worker.run();
    release();
    await first;

    expect(escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(1);
  });

  it('does not submit a contract call from the skipped tick', async () => {
    let release: () => void = () => undefined;
    escrowRepository.findShippedWithTracking.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([makeEscrow()]);
      }),
    );

    const first = worker.run();
    await Promise.resolve();
    await worker.run();
    release();
    await first;

    // Only the first run's own single delivery is submitted.
    expect(contractService.recordDelivery).toHaveBeenCalledTimes(1);
  });

  it('runs normally again once the previous run finishes', async () => {
    await worker.run();
    const callsAfterFirst = escrowRepository.findShippedWithTracking.mock.calls
      .length;

    await worker.run();

    expect(escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(
      callsAfterFirst + 1,
    );
  });

  it('clears the flag when a run throws, so later ticks still work', async () => {
    escrowRepository.findShippedWithTracking.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await worker.run();
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('still in progress'),
    );

    escrowRepository.findShippedWithTracking.mockResolvedValue([]);
    await worker.run();

    expect(escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(2);
  });

  it('resolves rather than rejecting when a run throws', async () => {
    escrowRepository.findShippedWithTracking.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(worker.run()).resolves.toBeUndefined();
  });

  it('clears the flag when a per-escrow failure throws out of the loop', async () => {
    // A throwing logistics call is caught per-escrow, so the cycle still
    // completes; the flag must be released.
    logisticsService.getStatus.mockRejectedValue(new Error('logistics down'));
    escrowRepository.findShippedWithTracking.mockResolvedValue([
      makeEscrow(),
    ]);

    await worker.run();
    await worker.run();

    expect(logisticsService.getStatus).toHaveBeenCalledTimes(2);
  });

  it('does not overlap after many rapid ticks', async () => {
    let release: () => void = () => undefined;
    escrowRepository.findShippedWithTracking.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );

    const first = worker.run();
    await Promise.resolve();
    // Five ticks land while the first is still in flight.
    for (let i = 0; i < 5; i++) {
      await worker.run();
    }
    release();
    await first;

    expect(escrowRepository.findShippedWithTracking).toHaveBeenCalledTimes(1);
  });
});
