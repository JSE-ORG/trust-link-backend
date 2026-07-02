/**
 * Unit tests for GET /escrow/:id/tracking Redis caching behaviour (issue #308).
 *
 * Covers:
 * - Cache hit: logistics API is NOT called when a cached result exists
 * - Cache write: result stored with 60-second TTL on logistics API success
 * - Cache miss → logistics failure → NotFoundException (API unreachable)
 * - Cache invalidation: tracking cache key is deleted when a shipment is marked
 * - Cache hit returned when logistics API is unreachable (fallback)
 */
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EscrowService } from '../../src/escrow/escrow.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { CacheService } from '../../src/cache/cache.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { EscrowRecord } from '../../src/prisma/prisma.service';
import { S3PresignService } from '../../src/common/services/s3-presign.service';
import { ContractService } from '../../src/stellar/contract.service';

const ESCROW_ID = 'escrow-caching-001';
const TRACKING_ID = 'TRK-CACHE-001';
const VENDOR = 'GV1VENDOR000000000000000000000000000000000000000000000000';
const BUYER = 'GB1BUYER0000000000000000000000000000000000000000000000000';

const makeEscrow = (overrides: Partial<EscrowRecord> = {}): EscrowRecord => ({
  id: ESCROW_ID,
  itemName: 'Laptop',
  itemRef: 'laptop-001',
  amount: 500,
  currency: 'USDC',
  buyerAddress: BUYER,
  vendorAddress: VENDOR,
  state: 'SHIPPED',
  trackingId: TRACKING_ID,
  shippedAt: new Date('2026-06-01T00:00:00.000Z'),
  deliveredAt: null,
  deliveryRecordedAt: null,
  autoReleaseSubmittedAt: null,
  autoReleaseTxHash: null,
  disputeId: null,
  cancelledAt: null,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  ...overrides,
});

describe('EscrowService tracking cache (issue #308)', () => {
  let service: EscrowService;
  let repository: jest.Mocked<EscrowRepository>;
  let logisticsService: jest.Mocked<LogisticsService>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      markShipped: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    logisticsService = {
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<LogisticsService>;

    cacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: EscrowRepository, useValue: repository },
        { provide: LogisticsService, useValue: logisticsService },
        { provide: CacheService, useValue: cacheService },
        {
          provide: NotificationsService,
          useValue: { notifyShipped: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: S3PresignService, useValue: {} },
        { provide: ContractService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(EscrowService);
  });

  describe('getTracking — cache behaviour', () => {
    it('returns cached data without calling the logistics API on a cache hit', async () => {
      const cached = {
        status: 'DELIVERED',
        estimatedDelivery: undefined,
        carrier: 'FedEx',
        events: [],
      };
      repository.findById.mockResolvedValue(makeEscrow());
      cacheService.get.mockResolvedValue(cached);

      const result = await service.getTracking(ESCROW_ID);

      expect(result).toEqual(cached);
      expect(logisticsService.getStatus).not.toHaveBeenCalled();
    });

    it('stores the logistics response in the cache with a 60-second TTL on a cache miss', async () => {
      repository.findById.mockResolvedValue(makeEscrow());
      cacheService.get.mockResolvedValue(null);
      logisticsService.getStatus.mockResolvedValue({
        status: 'IN_TRANSIT',
      } as any);

      await service.getTracking(ESCROW_ID);

      expect(cacheService.set).toHaveBeenCalledWith(
        `tracking:${TRACKING_ID}`,
        expect.objectContaining({ status: 'IN_TRANSIT' }),
        60,
      );
    });

    it('throws NotFoundException when logistics API is unreachable and no cache exists', async () => {
      repository.findById.mockResolvedValue(makeEscrow());
      cacheService.get.mockResolvedValue(null);
      logisticsService.getStatus.mockRejectedValue(new Error('timeout'));

      await expect(service.getTracking(ESCROW_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns stale cached data when logistics API is unreachable', async () => {
      const stale = {
        status: 'IN_TRANSIT',
        estimatedDelivery: undefined,
        carrier: 'DHL',
        events: [],
      };
      repository.findById.mockResolvedValue(makeEscrow());
      cacheService.get.mockResolvedValue(stale);
      logisticsService.getStatus.mockRejectedValue(new Error('timeout'));

      const result = await service.getTracking(ESCROW_ID);

      expect(result).toEqual(stale);
      expect(logisticsService.getStatus).not.toHaveBeenCalled();
    });

    it('uses the tracking ID as the cache key', async () => {
      repository.findById.mockResolvedValue(makeEscrow());
      cacheService.get.mockResolvedValue(null);
      logisticsService.getStatus.mockResolvedValue({
        status: 'PENDING',
      } as any);

      await service.getTracking(ESCROW_ID);

      expect(cacheService.get).toHaveBeenCalledWith(`tracking:${TRACKING_ID}`);
    });
  });

  describe('cache invalidation on tracking status update', () => {
    it('deletes the tracking cache entry when a shipment is marked (handleShipment)', async () => {
      const fundedEscrow = makeEscrow({ state: 'FUNDED', trackingId: null });
      const shippedEscrow = makeEscrow({
        state: 'SHIPPED',
        trackingId: TRACKING_ID,
      });

      repository.findById.mockResolvedValue(fundedEscrow);
      repository.markShipped.mockResolvedValue(shippedEscrow);
      cacheService.del.mockResolvedValue(undefined);

      await service.handleShipment(ESCROW_ID, VENDOR, TRACKING_ID);

      expect(cacheService.del).toHaveBeenCalledWith(`tracking:${TRACKING_ID}`);
    });

    it('invalidates the correct tracking key (trimmed tracking ID)', async () => {
      const paddedId = `  ${TRACKING_ID}  `;
      const fundedEscrow = makeEscrow({ state: 'FUNDED', trackingId: null });
      const shippedEscrow = makeEscrow({
        state: 'SHIPPED',
        trackingId: TRACKING_ID,
      });

      repository.findById.mockResolvedValue(fundedEscrow);
      repository.markShipped.mockResolvedValue(shippedEscrow);
      cacheService.del.mockResolvedValue(undefined);

      await service.handleShipment(ESCROW_ID, VENDOR, paddedId);

      expect(cacheService.del).toHaveBeenCalledWith(`tracking:${TRACKING_ID}`);
    });
  });
});
