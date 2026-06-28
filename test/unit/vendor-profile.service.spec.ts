/**
 * Unit tests for VendorProfileService (src/vendor/vendor-profile.service.ts — issue #287).
 *
 * All VendorProfileRepository methods are mocked; no database is needed.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VendorProfileService } from '../../src/vendor/vendor-profile.service';
import { VendorProfileRepository } from '../../src/vendor/vendor-profile.repository';
import { CreateVendorProfileDto } from '../../src/vendor/dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from '../../src/vendor/dto/update-vendor-profile.dto';

// ── fixture factory ────────────────────────────────────────────────────────

const VENDOR_ADDRESS =
  'GVENDOR00000000000000000000000000000000000000000000000000';

function makeProfile(
  overrides: Partial<{
    address: string;
    businessName: string;
    email: string | null;
    phone: string | null;
    description: string | null;
  }> = {},
) {
  return {
    id: 'profile-1',
    address: VENDOR_ADDRESS,
    businessName: 'Acme Ltd',
    email: null,
    phone: null,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const createDto: CreateVendorProfileDto = {
  businessName: 'Acme Ltd',
  email: 'acme@example.com',
  phone: '+1-555-0100',
  description: 'Electronics reseller',
};

const updateDto: UpdateVendorProfileDto = {
  businessName: 'Acme Electronics',
};

// ── test suite ─────────────────────────────────────────────────────────────

describe('VendorProfileService (issue #287)', () => {
  let service: VendorProfileService;
  let repository: jest.Mocked<VendorProfileRepository>;

  beforeEach(async () => {
    repository = {
      findByAddress: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateNotificationPreferences: jest.fn(),
      findNotificationPreferences: jest.fn(),
    } as unknown as jest.Mocked<VendorProfileRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorProfileService,
        { provide: VendorProfileRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(VendorProfileService);
  });

  // ── createProfile ────────────────────────────────────────────────────────

  describe('createProfile()', () => {
    it('creates and returns a profile when none exists', async () => {
      const profile = makeProfile();
      repository.findByAddress.mockResolvedValue(null);
      repository.create.mockResolvedValue(profile);

      const result = await service.createProfile(VENDOR_ADDRESS, createDto);

      expect(repository.findByAddress).toHaveBeenCalledWith(VENDOR_ADDRESS);
      expect(repository.create).toHaveBeenCalledWith(VENDOR_ADDRESS, createDto);
      expect(result).toEqual(profile);
    });

    it('throws ConflictException when a profile already exists (duplicate)', async () => {
      repository.findByAddress.mockResolvedValue(makeProfile());

      await expect(
        service.createProfile(VENDOR_ADDRESS, createDto),
      ).rejects.toThrow(ConflictException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('propagates repository errors', async () => {
      repository.findByAddress.mockResolvedValue(null);
      repository.create.mockRejectedValue(new Error('DB unavailable'));

      await expect(
        service.createProfile(VENDOR_ADDRESS, createDto),
      ).rejects.toThrow('DB unavailable');
    });
  });

  // ── getProfile ───────────────────────────────────────────────────────────

  describe('getProfile()', () => {
    it('returns the profile when it exists', async () => {
      const profile = makeProfile();
      repository.findByAddress.mockResolvedValue(profile);

      const result = await service.getProfile(VENDOR_ADDRESS);
      expect(result).toEqual(profile);
      expect(repository.findByAddress).toHaveBeenCalledWith(VENDOR_ADDRESS);
    });

    it('throws NotFoundException when no profile exists for the address', async () => {
      repository.findByAddress.mockResolvedValue(null);

      await expect(service.getProfile(VENDOR_ADDRESS)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for an unknown address', async () => {
      repository.findByAddress.mockResolvedValue(null);

      await expect(
        service.getProfile(
          'GUNKNOWN0000000000000000000000000000000000000000000000',
        ),
      ).rejects.toThrow('Vendor profile not found');
    });
  });

  // ── updateProfile ────────────────────────────────────────────────────────

  describe('updateProfile()', () => {
    it('applies a partial update when the profile exists', async () => {
      const existing = makeProfile();
      const updated = makeProfile({ businessName: 'Acme Electronics' });
      repository.findByAddress.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.updateProfile(VENDOR_ADDRESS, updateDto);

      expect(repository.update).toHaveBeenCalledWith(VENDOR_ADDRESS, updateDto);
      expect(result.businessName).toBe('Acme Electronics');
    });

    it('throws NotFoundException when the profile does not exist', async () => {
      repository.findByAddress.mockResolvedValue(null);

      await expect(
        service.updateProfile(VENDOR_ADDRESS, updateDto),
      ).rejects.toThrow(NotFoundException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the update DTO has no fields', async () => {
      await expect(service.updateProfile(VENDOR_ADDRESS, {})).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.findByAddress).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('ignores undefined-valued keys and throws BadRequestException for all-undefined DTO', async () => {
      const dtoWithUndefined: UpdateVendorProfileDto = {
        businessName: undefined,
        email: undefined,
      };

      await expect(
        service.updateProfile(VENDOR_ADDRESS, dtoWithUndefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── upsertProfile ────────────────────────────────────────────────────────

  describe('upsertProfile()', () => {
    it('creates the profile when it does not exist', async () => {
      const profile = makeProfile();
      repository.upsert.mockResolvedValue(profile);

      const result = await service.upsertProfile(VENDOR_ADDRESS, createDto);

      expect(repository.upsert).toHaveBeenCalledWith(VENDOR_ADDRESS, createDto);
      expect(result).toEqual(profile);
    });

    it('updates the profile when it already exists', async () => {
      const updated = makeProfile({ businessName: 'Updated Name' });
      repository.upsert.mockResolvedValue(updated);

      const result = await service.upsertProfile(VENDOR_ADDRESS, {
        ...createDto,
        businessName: 'Updated Name',
      });

      expect(result.businessName).toBe('Updated Name');
    });
  });
});
