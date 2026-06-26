/* eslint-disable @typescript-eslint/unbound-method */
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
    const createdEscrow = {
      ...fundedEscrow,
      id: 'escrow-2',
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
    expect(notifications.notifyFunded).toHaveBeenCalledWith(createdEscrow);
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
});
