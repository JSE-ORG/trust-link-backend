import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import https://github.com/JSE-ORG/trust-link-backend/pull/583/conflict?name=test%252Funit%252Fescrow.service.spec.ts&ancestor_oid=4aecad21d4c8c93ccff3ac31d2482698925613f8&base_oid=5e59d44a73cbf14bdd59b06864ce64e281af5ccf&head_oid=e109c784b18ea461494a318263f44c1603b67224{ NotificationsService } from '../../src/notifications/notifications.service';
import { EscrowRecord } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { EscrowService } from '../../src/escrow/escrow.service';
import { S3PresignService } from '../../src/common/services/s3-presign.service';
import { ContractService } from '../../src/stellar/contract.service';

describe('EscrowService.handleShipment (issue #16)', () => {
  let service: EscrowService;
  let repository: jest.Mocked<EscrowRepository>;
  let notifications: jest.Mocked<NotificationsService>;

  const fundedEscrow: EscrowRecord = {
    id: 'escrow-1',
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
      state: 'CREATED',
    };
    repository.findByVendorAndItem.mockResolvedValue(null);
    repository.create.mockResolvedValue(createdEscrow);
    notifications.notifyFunded.mockResolvedValue();

    await expect(
      service.createEscrow(createDto as any, 'vendor-address'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'escrow-2',
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
      service.createEscrow(createDto as any, 'vendor-address'),
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
      service.createEscrow(createDto as any, 'vendor-address'),
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
      expect(contractService.cancelEscrowOnChain).toHaveBeenCalledWith(
        escrow.id,
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
});
