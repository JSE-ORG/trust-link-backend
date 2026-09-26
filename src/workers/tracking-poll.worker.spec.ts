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
