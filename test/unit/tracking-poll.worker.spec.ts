import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { TrackingPollWorker } from '../../src/workers/tracking-poll.worker';
import { ContractService } from '../../src/stellar/contract.service';
import { ConfigService } from '../../src/config/config.service';

describe('TrackingPollWorker (issue #11)', () => {
  let worker: TrackingPollWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let logisticsService: jest.Mocked<LogisticsService>;
  let contractService: jest.Mocked<ContractService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    escrowRepository = {
      findShippedWithTracking: jest.fn(),
      markDelivered: jest.fn(),
      claimDelivery: jest.fn(),
      clearDeliveryClaim: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;
    logisticsService = {
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<LogisticsService>;
    contractService = {
      recordDelivery: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') {
          return process.env.NODE_ENV ?? 'test';
        }
        // record_delivery require_auth()s the caller and the contract only
        // accepts the admin, so the worker resolves this on use.
        if (key === 'ADMIN_ADDRESS') {
          return 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
        }
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingPollWorker,
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: LogisticsService, useValue: logisticsService },
        { provide: ContractService, useValue: contractService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    worker = moduleRef.get(TrackingPollWorker);
  });

  it('marks delivered escrows and records the delivery contract call', async () => {
    const escrow = {
      id: 'escrow-1',
      contractEscrowId: 7n,
      itemName: 'Camera',
      amount: 250,
      currency: 'USDC',
      itemRef: 'ref-1',
      buyerAddress: 'buyer-1',
      vendorAddress: 'vendor-1',
      state: 'SHIPPED' as const,
      trackingId: 'TRK-1',
      deliveredAt: null,
      deliveryRecordedAt: null,
      autoReleaseSubmittedAt: null,
      autoReleaseTxHash: null,
      disputeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelledAt: null,
      shippedAt: null,
      buyerContactEmail: null,
      buyerContactPhone: null,
    };
    escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
    escrowRepository.claimDelivery.mockResolvedValue(escrow);
    logisticsService.getStatus.mockResolvedValue({
      status: 'DELIVERED',
      events: [],
    });
    contractService.recordDelivery.mockResolvedValue('record-hash');

    await worker.run();

    expect(escrowRepository.claimDelivery).toHaveBeenCalledWith('escrow-1');
    expect(contractService.recordDelivery).toHaveBeenCalledWith(
      7n,
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    expect(escrowRepository.markDelivered).toHaveBeenCalledWith(
      'escrow-1',
      expect.any(Date),
    );
  });

  it('clears the delivery claim when contract call fails, leaving escrow retryable', async () => {
    const escrow = {
      id: 'escrow-1',
      contractEscrowId: 7n,
      itemName: 'Camera',
      amount: 250,
      currency: 'USDC',
      itemRef: 'ref-1',
      buyerAddress: 'buyer-1',
      vendorAddress: 'vendor-1',
      state: 'SHIPPED' as const,
      trackingId: 'TRK-1',
      deliveredAt: null,
      deliveryRecordedAt: null,
      autoReleaseSubmittedAt: null,
      autoReleaseTxHash: null,
      disputeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelledAt: null,
      shippedAt: null,
      buyerContactEmail: null,
      buyerContactPhone: null,
    };
    escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
    escrowRepository.claimDelivery.mockResolvedValue(escrow);
    logisticsService.getStatus.mockResolvedValue({
      status: 'DELIVERED',
      events: [],
    });
    contractService.recordDelivery.mockRejectedValue(
      new Error('contract timeout'),
    );

    await expect(worker.run()).resolves.toBeUndefined();

    // The claim must be cleared so the next poll cycle retries
    expect(escrowRepository.clearDeliveryClaim).toHaveBeenCalledWith(
      'escrow-1',
    );
    // The escrow should NOT be marked delivered since the contract call failed
    expect(escrowRepository.markDelivered).not.toHaveBeenCalled();
  });

  it('keeps polling resilient to carrier API failures', async () => {
    const escrow = {
      id: 'escrow-1',
      contractEscrowId: 7n,
      itemName: 'Camera',
      amount: 250,
      currency: 'USDC',
      itemRef: 'ref-1',
      buyerAddress: 'buyer-1',
      vendorAddress: 'vendor-1',
      state: 'SHIPPED' as const,
      trackingId: 'TRK-1',
      deliveredAt: null,
      deliveryRecordedAt: null,
      autoReleaseSubmittedAt: null,
      autoReleaseTxHash: null,
      disputeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelledAt: null,
      shippedAt: null,
      buyerContactEmail: null,
      buyerContactPhone: null,
    };
    escrowRepository.findShippedWithTracking.mockResolvedValue([escrow]);
    logisticsService.getStatus.mockRejectedValue(new Error('carrier down'));

    await expect(worker.run()).resolves.toBeUndefined();
    expect(escrowRepository.claimDelivery).not.toHaveBeenCalled();
    expect(contractService.recordDelivery).not.toHaveBeenCalled();
  });

  it('catches top-level poll failures so interval handlers do not reject', async () => {
    escrowRepository.findShippedWithTracking.mockRejectedValue(
      new Error('database unavailable'),
    );
    const loggerSpy = jest
      .spyOn((worker as unknown as { logger: Logger }).logger, 'error')
      .mockImplementation();

    await expect(worker.run()).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('tracking_poll.worker_failed'),
      expect.any(String),
    );
  });
});
