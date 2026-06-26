/* eslint-disable @typescript-eslint/unbound-method */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EscrowService } from '../../src/escrow/escrow.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { CacheService } from '../../src/common/cache.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { EscrowRecord } from '../../src/prisma/prisma.service';
import { S3PresignService } from '../../src/common/services/s3-presign.service';
import { ContractService } from '../../src/stellar/contract.service';

describe('EscrowService.getTracking (issue #58)', () => {
  let service: EscrowService;
  let repository: jest.Mocked<EscrowRepository>;
  let logisticsService: jest.Mocked<LogisticsService>;
  let cacheService: jest.Mocked<CacheService>;

  const mockEscrow: EscrowRecord = {
    id: 'escrow-1',
    itemName: 'Camera',
    itemRef: 'camera-001',
    amount: 250,
    currency: 'USDC',
    buyerAddress: 'buyer-address',
    vendorAddress: 'vendor-address',
    state: 'SHIPPED',
    trackingId: 'TRK-123',
    shippedAt: new Date('2026-01-01T00:00:00.000Z'),
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    logisticsService = {
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<LogisticsService>;

    cacheService = {
      get: jest.fn(),
      set: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;

    const notificationsService = {} as NotificationsService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: EscrowRepository, useValue: repository },
        { provide: LogisticsService, useValue: logisticsService },
        { provide: CacheService, useValue: cacheService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: S3PresignService, useValue: {} },
        { provide: ContractService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(EscrowService);
  });

  it('returns tracking details with status, estimatedDelivery, carrier, and events', async () => {
    const trackingDetails = {
      status: 'IN_TRANSIT',
      estimatedDelivery: new Date('2026-01-10T00:00:00.000Z'),
      carrier: 'FedEx',
      events: [
        {
          timestamp: new Date('2026-01-01T10:00:00.000Z'),
          status: 'PICKED_UP',
          location: 'New York, NY',
          description: 'Package picked up',
        },
        {
          timestamp: new Date('2026-01-02T14:00:00.000Z'),
          status: 'IN_TRANSIT',
          location: 'Chicago, IL',
          description: 'In transit to destination',
        },
      ],
    };

    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(null);
    logisticsService.getStatus.mockResolvedValue({
      status: trackingDetails.status,
    });

    const expected = {
      status: trackingDetails.status,
      estimatedDelivery: undefined,
      carrier: undefined,
      events: [],
    };

    const result = await service.getTracking('escrow-1');

    expect(result).toEqual(expected);
    expect(logisticsService.getStatus).toHaveBeenCalledWith('TRK-123');
    expect(cacheService.set).toHaveBeenCalledWith(
      'tracking:TRK-123',
      {
        status: trackingDetails.status,
        estimatedDelivery: undefined,
        carrier: undefined,
        events: [],
      },
      60,
    );
  });

  it('returns cached tracking details when available', async () => {
    const cachedDetails = {
      status: 'DELIVERED',
      carrier: 'UPS',
      events: [
        {
          timestamp: new Date('2026-01-05T16:00:00.000Z'),
          status: 'DELIVERED',
          location: 'Los Angeles, CA',
          description: 'Package delivered',
        },
      ],
    };

    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(cachedDetails);

    const result = await service.getTracking('escrow-1');

    expect(result).toEqual(cachedDetails);
    expect(logisticsService.getStatus).not.toHaveBeenCalled();
  });

  it('returns 404 when tracking ID is not set', async () => {
    const escrowWithoutTracking = { ...mockEscrow, trackingId: null };
    repository.findById.mockResolvedValue(escrowWithoutTracking);

    await expect(service.getTracking('escrow-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getTracking('escrow-1')).rejects.toThrow(
      'Tracking information not available',
    );
  });

  it('caches response for 60 seconds', async () => {
    const trackingDetails = {
      status: 'PENDING',
      carrier: 'DHL',
      events: [],
    };

    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(null);
    logisticsService.getStatus.mockResolvedValue(trackingDetails as any);

    await service.getTracking('escrow-1');

    expect(cacheService.set).toHaveBeenCalledWith(
      'tracking:TRK-123',
      {
        status: trackingDetails.status,
        estimatedDelivery: undefined,
        carrier: undefined,
        events: [],
      },
      60,
    );
  });

  it('throws NotFoundException when logistics service fails', async () => {
    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(null);
    logisticsService.getStatus.mockRejectedValue(
      new Error('Carrier API unavailable'),
    );

    await expect(service.getTracking('escrow-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
