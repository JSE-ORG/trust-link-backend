import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EscrowService } from '../../src/escrow/escrow.service';
import { LogisticsStatus } from '../../src/logistics/logistics.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { CacheService } from '../../src/cache/cache.service';
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
    const providerResponse = {
      status: 'IN_TRANSIT' as LogisticsStatus,
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
    logisticsService.getStatus.mockResolvedValue(providerResponse);

    const result = await service.getTracking('escrow-1');

    expect(result).toEqual({
      status: providerResponse.status,
      estimatedDelivery: providerResponse.estimatedDelivery,
      carrier: providerResponse.carrier,
      events: providerResponse.events,
    });
    expect(logisticsService.getStatus).toHaveBeenCalledWith('TRK-123');
    expect(cacheService.set).toHaveBeenCalledWith(
      'tracking:TRK-123',
      {
        status: providerResponse.status,
        estimatedDelivery: providerResponse.estimatedDelivery,
        carrier: providerResponse.carrier,
        events: providerResponse.events,
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
    const providerResponse = {
      status: 'PENDING' as LogisticsStatus,
      estimatedDelivery: new Date('2026-01-15T00:00:00.000Z'),
      carrier: 'DHL',
      events: [
        {
          timestamp: new Date('2026-01-01T08:00:00.000Z'),
          status: 'PICKED_UP',
          location: 'Berlin, DE',
          description: 'Package picked up by DHL',
        },
      ],
    };

    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(null);
    logisticsService.getStatus.mockResolvedValue(providerResponse);

    await service.getTracking('escrow-1');

    expect(cacheService.set).toHaveBeenCalledWith(
      'tracking:TRK-123',
      {
        status: providerResponse.status,
        estimatedDelivery: providerResponse.estimatedDelivery,
        carrier: providerResponse.carrier,
        events: providerResponse.events,
      },
      60,
    );
  });

  it('does not cache a provider failure', async () => {
    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(null);
    logisticsService.getStatus.mockRejectedValue(
      new Error('Carrier API unavailable'),
    );

    await expect(service.getTracking('escrow-1')).rejects.toThrow(
      NotFoundException,
    );

    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('passes through multi-event provider response with carrier and estimated delivery intact', async () => {
    const providerResponse = {
      status: 'IN_TRANSIT' as LogisticsStatus,
      estimatedDelivery: new Date('2026-01-20T00:00:00.000Z'),
      carrier: 'UPS',
      events: [
        {
          timestamp: new Date('2026-01-01T06:00:00.000Z'),
          status: 'PICKED_UP',
          location: 'Memphis, TN',
          description: 'Package picked up',
        },
        {
          timestamp: new Date('2026-01-02T10:00:00.000Z'),
          status: 'IN_TRANSIT',
          location: 'Louisville, KY',
          description: 'Arrived at sort facility',
        },
        {
          timestamp: new Date('2026-01-03T14:00:00.000Z'),
          status: 'IN_TRANSIT',
          location: 'Dallas, TX',
          description: 'Departed sort facility',
        },
      ],
    };

    repository.findById.mockResolvedValue(mockEscrow);
    cacheService.get.mockResolvedValue(null);
    logisticsService.getStatus.mockResolvedValue(providerResponse);

    const result = await service.getTracking('escrow-1');

    expect(result.carrier).toBe('UPS');
    expect(result.estimatedDelivery).toEqual(
      new Date('2026-01-20T00:00:00.000Z'),
    );
    expect(result.events).toHaveLength(3);
    expect(result.events[0].status).toBe('PICKED_UP');
    expect(result.events[1].status).toBe('IN_TRANSIT');
    expect(result.events[2].status).toBe('IN_TRANSIT');
  });

  it('returns full shape from cache hit', async () => {
    const cachedResponse = {
      status: 'DELIVERED',
      estimatedDelivery: new Date('2026-01-05T16:00:00.000Z'),
      carrier: 'FedEx',
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
    cacheService.get.mockResolvedValue(cachedResponse);

    const result = await service.getTracking('escrow-1');

    expect(result.carrier).toBe('FedEx');
    expect(result.estimatedDelivery).toEqual(
      new Date('2026-01-05T16:00:00.000Z'),
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].status).toBe('DELIVERED');
    expect(logisticsService.getStatus).not.toHaveBeenCalled();
  });
});
