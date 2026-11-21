import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicVendorController } from './public-vendor.controller';
import { VendorProfileRepository } from './vendor-profile.repository';
import { EscrowRepository } from '../escrow/escrow.repository';
import type { VendorProfileRecord } from '../prisma/prisma.service';

describe('PublicVendorController (#1153)', () => {
  let controller: PublicVendorController;
  let vendorProfileRepo: jest.Mocked<
    Pick<VendorProfileRepository, 'findByAddress'>
  >;
  let escrowRepo: jest.Mocked<Pick<EscrowRepository, 'getVendorPublicStats'>>;

  const validAddress =
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const invalidAddress = 'not-a-valid-stellar-address';
  const unknownAddress =
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

  beforeEach(() => {
    vendorProfileRepo = {
      findByAddress: jest.fn(),
    };
    escrowRepo = {
      getVendorPublicStats: jest.fn(),
    };
    controller = new PublicVendorController(
      vendorProfileRepo as unknown as VendorProfileRepository,
      escrowRepo as unknown as EscrowRepository,
    );
  });

  it('throws 400 BadRequestException for an invalid Stellar address', async () => {
    await expect(controller.getPublicProfile(invalidAddress)).rejects.toThrow(
      BadRequestException,
    );
    expect(vendorProfileRepo.findByAddress).not.toHaveBeenCalled();
  });

  it('throws 404 NotFoundException for an unknown vendor address', async () => {
    vendorProfileRepo.findByAddress.mockResolvedValue(null);

    await expect(controller.getPublicProfile(unknownAddress)).rejects.toThrow(
      NotFoundException,
    );
    expect(vendorProfileRepo.findByAddress).toHaveBeenCalledWith(
      unknownAddress,
    );
    expect(escrowRepo.getVendorPublicStats).not.toHaveBeenCalled();
  });

  it('returns public fields only (field allow list) and never exposes private details', async () => {
    const createdAt = new Date('2026-02-15T10:00:00.000Z');
    vendorProfileRepo.findByAddress.mockResolvedValue({
      id: 'profile-1',
      address: validAddress,
      businessName: 'Stellar Goods Inc',
      description: 'Quality goods on Stellar',
      email: 'secret-vendor@example.com',
      phone: '+1234567890',
      createdAt,
      updatedAt: new Date(),
    } as unknown as VendorProfileRecord);

    escrowRepo.getVendorPublicStats.mockResolvedValue({
      completedEscrows: 15,
      disputeRate: 2.5,
    });

    const result = await controller.getPublicProfile(validAddress);

    expect(result).toEqual({
      businessName: 'Stellar Goods Inc',
      description: 'Quality goods on Stellar',
      memberSince: createdAt,
      completedEscrows: 15,
      disputeRate: 2.5,
    });

    // Explicitly verify sensitive fields are absent
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('accountDetails');
    expect(result).not.toHaveProperty('trackingSettings');
    expect(result).not.toHaveProperty('settings');
    expect(Object.keys(result).sort()).toEqual([
      'businessName',
      'completedEscrows',
      'description',
      'disputeRate',
      'memberSince',
    ]);
  });
});
