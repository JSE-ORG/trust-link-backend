import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { EscrowRecord } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { EscrowService } from '../../src/escrow/escrow.service';
import { S3PresignService } from '../../src/common/services/s3-presign.service';
import { ContractService } from '../../src/stellar/contract.service';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { CacheService } from '../../src/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('EscrowService.handleShipment (issue #16)', () => {
  let service: EscrowService;
  let repository: jest.Mocked<EscrowRepository>;
  let notifications: jest.Mocked<NotificationsService>;

  const fundedEscrow: EscrowRecord = {
    id: 'escrow-1',
    contractEscrowId: 7n,
    itemName: 'Leather bag',
    itemRef: 'bag-123',
    amount: 125,
    currency: 'USDC',
    buyerAddress: 'buyer-address',
    vendorAddress: 'vendor-address',
    state: 'FUNDED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByVendorAndItem: jest.fn(),
      markShipped: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;
    notifications = {
      notifyFunded: jest.fn(),
      notifyShipped: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: EscrowRepository, useValue: repository },
        { provide: NotificationsService, useValue: notifications },
        { provide: S3PresignService, useValue: {} },
        { provide: ContractService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(EscrowService);
  });

  it('updates escrow state and sends a shipment notification', async () => {
    const shipped = {
      ...fundedEscrow,
      state: 'SHIPPED' as const,
      trackingId: 'TRK-123',
    };
    repository.findById.mockResolvedValue(fundedEscrow);
    repository.markShipped.mockResolvedValue(shipped);
    notifications.notifyShipped.mockResolvedValue();

    await expect(
      service.handleShipment('escrow-1', 'vendor-address', 'TRK-123'),
    ).resolves.toEqual(shipped);

    expect(repository.markShipped).toHaveBeenCalledWith('escrow-1', 'TRK-123');
    expect(notifications.notifyShipped).toHaveBeenCalledWith(shipped);
  });

  it('throws ForbiddenException for the wrong vendor', async () => {
    repository.findById.mockResolvedValue(fundedEscrow);

    await expect(
      service.handleShipment('escrow-1', 'other-vendor', 'TRK-123'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException when escrow is not funded', async () => {
    repository.findById.mockResolvedValue({
      ...fundedEscrow,
      state: 'SHIPPED',
    });

    await expect(
      service.handleShipment('escrow-1', 'vendor-address', 'TRK-123'),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException for an empty tracking ID', async () => {
    await expect(
      service.handleShipment('escrow-1', 'vendor-address', '   '),
    ).rejects.toThrow(BadRequestException);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('keeps not-found escrow errors explicit', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.handleShipment('missing', 'vendor-address', 'TRK-123'),
    ).rejects.toThrow(NotFoundException);
  });

  it('creates a new escrow and returns a payment URL', async () => {
    const createDto = {
      itemName: 'Leather bag',
      itemRef: 'bag-123',
      amount: 125,
      currency: 'USDC',
      buyerAddress: 'buyer-address',
    };
    const createdEscrow: EscrowRecord = {
      ...fundedEscrow,
      id: 'escrow-2',
      contractEscrowId: 7n,
      state: 'CREATED',
    };
    repository.findByVendorAndItem.mockResolvedValue(null);
    repository.create.mockResolvedValue(createdEscrow);
    notifications.notifyFunded.mockResolvedValue();

    await expect(
      service.createEscrow(createDto, 'vendor-address'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'escrow-2',
        contractEscrowId: 7n,
        paymentUrl: 'https://trust-link.local/pay/escrow-2',
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(createDto, 'vendor-address');
    // Issue #550: #496 removed the notifyFunded call from createEscrow — an
    // escrow is CREATED, not FUNDED, at creation time. This is a negative
    // assertion (not just a deleted one) so the premature notification can't
    // silently come back. The corresponding positive-path coverage — that
    // notifyFunded *is* called once the escrow actually transitions to
    // FUNDED via the on-chain sync handler — already exists in
    // src/escrow/escrow.service.sync-state.spec.ts
    // ("EscrowFunded > transitions CREATED → FUNDED and sends notification").
    expect(notifications.notifyFunded).not.toHaveBeenCalled();
  });

  it('throws ConflictException for duplicate escrow references', async () => {
    const createDto = {
      itemName: 'Leather bag',
      itemRef: 'bag-123',
      amount: 125,
      currency: 'USDC',
      buyerAddress: 'buyer-address',
    };
    repository.findByVendorAndItem.mockResolvedValue(fundedEscrow);

    await expect(
      service.createEscrow(createDto, 'vendor-address'),
    ).rejects.toThrow(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for invalid amount', async () => {
    const createDto = {
      itemName: 'Leather bag',
      itemRef: 'bag-123',
      amount: 0,
      currency: 'USDC',
      buyerAddress: 'buyer-address',
    };
    repository.findByVendorAndItem.mockResolvedValue(null);

    await expect(
      service.createEscrow(createDto, 'vendor-address'),
    ).rejects.toThrow(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  // Additional tests for cancellation, updateBuyerContact, and viewer projection
  describe('additional EscrowService behaviors (issue #409)', () => {
    it('cancelEscrow allows buyer, vendor, admin and rejects strangers', async () => {
      const escrow = { ...fundedEscrow };
      repository.findById.mockResolvedValue(escrow);
      repository.markCancelled = jest
        .fn()
        .mockResolvedValue({ ...escrow, state: 'CANCELLED' });

      // buyer allowed
      await expect(
        service.cancelEscrow(escrow.id, escrow.buyerAddress, false),
      ).resolves.toHaveProperty('state', 'CANCELLED');

      // vendor allowed
      await expect(
        service.cancelEscrow(escrow.id, escrow.vendorAddress, false),
      ).resolves.toHaveProperty('state', 'CANCELLED');

      // admin allowed
      await expect(
        service.cancelEscrow(escrow.id, 'some-rando', true),
      ).resolves.toHaveProperty('state', 'CANCELLED');

      // stranger rejected
      repository.findById.mockResolvedValue(escrow);
      await expect(
        service.cancelEscrow(escrow.id, 'not-related', false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cancelEscrow rejects non-FUNDED terminal transitions with ConflictException', async () => {
      const escrow = { ...fundedEscrow, state: 'COMPLETED' } as EscrowRecord;
      repository.findById.mockResolvedValue(escrow);

      await expect(
        service.cancelEscrow(escrow.id, escrow.buyerAddress, false),
      ).rejects.toThrow(ConflictException);
    });

    it('cancelPendingEscrow authorizes buyer/vendor/admin and consults chain state', async () => {
      const escrow = { ...fundedEscrow, state: 'CREATED' } as EscrowRecord;
      repository.findById.mockResolvedValue(escrow);
      const contractService = {
        getEscrowState: jest.fn(),
        cancelEscrowOnChain: jest.fn(),
      } as unknown as ContractService;

      // replace module service instance with one that has contract hooks
      (service as any).contractService = contractService;
      repository.markCancelled = jest
        .fn()
        .mockResolvedValue({ ...escrow, state: 'CANCELLED' });

      // chain reports FUNDED: should call cancelEscrowOnChain then markCancelled
      (contractService.getEscrowState as jest.Mock).mockResolvedValue({
        exists: true,
        state: 'FUNDED',
      });
      (contractService.cancelEscrowOnChain as jest.Mock).mockResolvedValue(
        'tx-123',
      );

      await expect(
        service.cancelPendingEscrow(escrow.id, escrow.vendorAddress, false),
      ).resolves.toHaveProperty('state', 'CANCELLED');
      // cancel_escrow(env, caller: Address, escrow_id: u64) addresses the
      // escrow by the contract's own id and require_auth()s the caller.
      expect(contractService.cancelEscrowOnChain).toHaveBeenCalledWith(
        escrow.contractEscrowId,
        escrow.vendorAddress,
      );

      // stranger rejected
      repository.findById.mockResolvedValue(escrow);
      await expect(
        service.cancelPendingEscrow(escrow.id, 'not-related', false),
      ).rejects.toThrow(ForbiddenException);

      // chain reports non-CREATED non-FUNDED -> conflict
      repository.findById.mockResolvedValue({ ...escrow, state: 'CREATED' });
      (contractService.getEscrowState as jest.Mock).mockResolvedValue({
        exists: true,
        state: 'SHIPPED',
      });
      await expect(
        service.cancelPendingEscrow(escrow.id, escrow.vendorAddress, false),
      ).rejects.toThrow(ConflictException);
    });

    it('updateBuyerContact rejects updates for terminal-state escrows', async () => {
      const escrow = { ...fundedEscrow, state: 'COMPLETED' } as EscrowRecord;
      repository.findById.mockResolvedValue(escrow);

      await expect(
        service.updateBuyerContact(escrow.id, { email: 'x@x.com' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('getEscrowForViewer sets isBuyer and isVendor flags and omits viewer when no caller', async () => {
      const escrow = {
        ...fundedEscrow,
        buyerContactEmail: 'a:b:c',
        buyerContactPhone: 'd:e:f',
      } as EscrowRecord;
      repository.findById.mockResolvedValue(escrow);

      const withBuyer = await service.getEscrowForViewer(
        escrow.id,
        escrow.buyerAddress,
      );
      expect(withBuyer.viewer).toEqual({ isBuyer: true, isVendor: false });

      const withVendor = await service.getEscrowForViewer(
        escrow.id,
        escrow.vendorAddress,
      );
      expect(withVendor.viewer).toEqual({ isBuyer: false, isVendor: true });

      const noViewer = await service.getEscrowForViewer(escrow.id);
      expect((noViewer as any).viewer).toBeUndefined();
    });

    it('toPublicEscrow never exposes buyerContactEmail or buyerContactPhone', async () => {
      const escrow = {
        ...fundedEscrow,
        buyerContactEmail: 'aa:bb:cc',
        buyerContactPhone: 'dd:ee:ff',
      } as EscrowRecord;
      repository.findById.mockResolvedValue(escrow);

      const pub = await service.getPublicEscrow(escrow.id);
      expect((pub as any).buyerContactEmail).toBeUndefined();
      expect((pub as any).buyerContactPhone).toBeUndefined();
    });
  });

  it('findById wraps a non-NotFoundException repository error as BadRequestException', async () => {
    repository.findById.mockRejectedValue(new Error('connection reset'));

    await expect(service.findById(fundedEscrow.id)).rejects.toThrow(
      BadRequestException,
    );
  });
});

// Issue #635: getTracking, createIdempotent, generateEvidenceUploadUrl, and
// findVendorEscrows had no coverage at all — this file's main describe block
// above wires @Optional() LogisticsService/CacheService/PrismaService as
// `undefined` (matching how Nest resolves an omitted optional provider), so
// they need their own module with those providers actually supplied.
describe('EscrowService: tracking, idempotency, evidence upload, and vendor listing (issue #635)', () => {
  let service: EscrowService;
  let repository: jest.Mocked<EscrowRepository>;
  let s3Presign: jest.Mocked<S3PresignService>;
  let logistics: jest.Mocked<LogisticsService>;
  let cache: jest.Mocked<CacheService>;

  const shippedEscrow: EscrowRecord = {
    id: 'escrow-shipped',
    contractEscrowId: 9n,
    itemName: 'Camera',
    itemRef: 'cam-1',
    amount: 250,
    currency: 'USDC',
    buyerAddress: 'buyer-1',
    vendorAddress: 'vendor-1',
    state: 'SHIPPED',
    trackingId: 'TRK-1',
    shippedAt: new Date('2026-01-02T00:00:00.000Z'),
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as EscrowRecord;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findByVendorAndItem: jest.fn(),
      create: jest.fn(),
      findVendorEscrows: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;
    s3Presign = { presign: jest.fn() } as unknown as jest.Mocked<S3PresignService>;
    logistics = { getStatus: jest.fn() } as unknown as jest.Mocked<LogisticsService>;
    cache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: EscrowRepository, useValue: repository },
        { provide: NotificationsService, useValue: {} },
        { provide: S3PresignService, useValue: s3Presign },
        { provide: ContractService, useValue: {} },
        { provide: LogisticsService, useValue: logistics },
        { provide: CacheService, useValue: cache },
        { provide: PrismaService, useValue: undefined },
      ],
    }).compile();

    service = moduleRef.get(EscrowService);
  });

  describe('getTracking', () => {
    it('throws NotFoundException when the escrow has no trackingId', async () => {
      repository.findById.mockResolvedValue({
        ...shippedEscrow,
        trackingId: null,
      });

      await expect(service.getTracking(shippedEscrow.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a cached tracking result without calling the logistics service', async () => {
      repository.findById.mockResolvedValue(shippedEscrow);
      const cached = {
        status: 'IN_TRANSIT',
        events: [],
      };
      cache.get.mockResolvedValue(cached);

      await expect(service.getTracking(shippedEscrow.id)).resolves.toEqual(
        cached,
      );
      expect(logistics.getStatus).not.toHaveBeenCalled();
    });

    it('fetches, caches, and returns live tracking details on a cache miss', async () => {
      repository.findById.mockResolvedValue(shippedEscrow);
      cache.get.mockResolvedValue(null);
      logistics.getStatus.mockResolvedValue({
        status: 'DELIVERED',
        carrier: 'DHL',
        estimatedDelivery: new Date('2026-01-05T00:00:00.000Z'),
        events: [
          {
            timestamp: new Date('2026-01-04T00:00:00.000Z'),
            status: 'DELIVERED',
            description: 'Package delivered',
          },
        ],
      });

      const result = await service.getTracking(shippedEscrow.id);
      expect(result.status).toBe('DELIVERED');
      expect(result.carrier).toBe('DHL');
      expect(cache.set).toHaveBeenCalledWith(
        `tracking:${shippedEscrow.trackingId}`,
        expect.objectContaining({ status: 'DELIVERED' }),
        60,
      );
    });

    it('wraps a logistics service failure as NotFoundException', async () => {
      repository.findById.mockResolvedValue(shippedEscrow);
      cache.get.mockResolvedValue(null);
      logistics.getStatus.mockRejectedValue(new Error('carrier API down'));

      await expect(service.getTracking(shippedEscrow.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getTracking without a logistics service configured', () => {
    it('throws NotFoundException even when a trackingId exists', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          EscrowService,
          { provide: EscrowRepository, useValue: repository },
          { provide: NotificationsService, useValue: {} },
          { provide: S3PresignService, useValue: s3Presign },
          { provide: ContractService, useValue: {} },
        ],
      }).compile();
      const noLogisticsService = moduleRef.get(EscrowService);
      repository.findById.mockResolvedValue(shippedEscrow);

      await expect(
        noLogisticsService.getTracking(shippedEscrow.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createIdempotent', () => {
    const createDto = {
      itemName: 'Camera',
      itemRef: 'cam-1',
      amount: 250,
      currency: 'USDC',
      buyerAddress: 'buyer-1',
    };

    it('returns the cached result on a repeat call with the same idempotency key', async () => {
      const cached = { ...shippedEscrow, paymentUrl: 'https://x/pay' };
      cache.get.mockResolvedValue(cached);

      const result = await service.createIdempotent(
        'idem-key-1',
        createDto as any,
        'vendor-1',
      );

      expect(result).toEqual(cached);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('creates and caches the escrow on a first call for the idempotency key', async () => {
      cache.get.mockResolvedValue(null);
      repository.findByVendorAndItem.mockResolvedValue(null);
      repository.create.mockResolvedValue(shippedEscrow);

      const result = await service.createIdempotent(
        'idem-key-2',
        createDto as any,
        'vendor-1',
      );

      expect(result).toMatchObject({ id: shippedEscrow.id });
      expect(cache.set).toHaveBeenCalledWith(
        'idempotency:vendor-1:idem-key-2',
        expect.objectContaining({ id: shippedEscrow.id }),
        86400,
      );
    });
  });

  describe('generateEvidenceUploadUrl', () => {
    it('derives the object key extension from the filename', () => {
      s3Presign.presign.mockReturnValue('https://signed-url');

      const result = service.generateEvidenceUploadUrl(
        'buyer-1',
        'photo.png',
      );

      expect(result.uploadUrl).toBe('https://signed-url');
      expect(result.storagePath).toBe('evidence/buyer-1/');
      expect(result.publicUrl).toMatch(/\.png$/);
      expect(result.fileName).toBe('photo.png');
    });

    it('falls back to a "bin" extension for a filename with no dot', () => {
      s3Presign.presign.mockReturnValue('https://signed-url');

      const result = service.generateEvidenceUploadUrl('buyer-1', 'noext');

      expect(result.publicUrl).toMatch(/\.bin$/);
    });
  });

  describe('findVendorEscrows', () => {
    it('applies default sort/order/page/limit when the query omits them', async () => {
      repository.findVendorEscrows.mockResolvedValue({
        data: [shippedEscrow],
        total: 1,
      });

      const result = await service.findVendorEscrows('vendor-1', {});

      expect(repository.findVendorEscrows).toHaveBeenCalledWith(
        'vendor-1',
        undefined,
        'date',
        'desc',
        1,
        20,
      );
      expect(result).toEqual({
        data: [
          expect.objectContaining({ id: shippedEscrow.id, amount: 250 }),
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('passes through explicit sort/order/page/limit/state', async () => {
      repository.findVendorEscrows.mockResolvedValue({ data: [], total: 0 });

      await service.findVendorEscrows('vendor-1', {
        state: 'SHIPPED',
        sort: 'amount',
        order: 'asc',
        page: 3,
        limit: 5,
      });

      expect(repository.findVendorEscrows).toHaveBeenCalledWith(
        'vendor-1',
        'SHIPPED',
        'amount',
        'asc',
        3,
        5,
      );
    });
  });
});
