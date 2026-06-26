import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VendorProfileRecord } from '../prisma/prisma.service';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationPreferencesResponseDto } from './dto/notification-preferences-response.dto';
import { VendorProfileRepository } from './vendor-profile.repository';

@Injectable()
export class VendorProfileService {
  constructor(private readonly repository: VendorProfileRepository) {}

  /** Creates a vendor profile when one does not already exist for the address. */
  async createProfile(
    address: string,
    dto: CreateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    const existing = await this.repository.findByAddress(address);
    if (existing) {
      throw new ConflictException('Vendor profile already exists');
    }
    return this.repository.create(address, dto);
  }

  /** Creates or updates the vendor profile for the given address (idempotent). */
  async upsertProfile(
    address: string,
    dto: CreateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.repository.upsert(address, dto);
  }

  /** Returns a vendor profile by address or raises a not-found error. */
  async getProfile(address: string): Promise<VendorProfileRecord> {
    const profile = await this.repository.findByAddress(address);
    if (!profile) {
      throw new NotFoundException('Vendor profile not found');
    }
    return profile;
  }

  /** Applies non-empty vendor profile updates after confirming the profile exists. */
  async updateProfile(
    address: string,
    dto: UpdateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    const keys = Object.keys(dto).filter(
      (k) => (dto as Record<string, unknown>)[k] !== undefined,
    );
    if (keys.length === 0) {
      throw new BadRequestException('No update fields provided');
    }

    const existing = await this.repository.findByAddress(address);
    if (!existing) {
      throw new NotFoundException('Vendor profile not found');
    }
    return this.repository.update(address, dto);
  }

  /** Updates notification preferences for the vendor, creating tracking settings if needed. */
  async updateNotificationPreferences(
    address: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<{ trackingSettings: Record<string, unknown> }> {
    const keys = Object.keys(dto).filter(
      (k) => (dto as Record<string, unknown>)[k] !== undefined,
    );
    if (keys.length === 0) {
      throw new BadRequestException(
        'No notification preference fields provided',
      );
    }

    const existing = await this.repository.findByAddress(address);
    if (!existing) {
      throw new NotFoundException('Vendor profile not found');
    }

    return this.repository.updateNotificationPreferences(address, dto);
  }

  /** Returns notification preferences with platform defaults for unconfigured fields. */
  async getNotificationPreferences(
    address: string,
  ): Promise<NotificationPreferencesResponseDto> {
    return this.repository.findNotificationPreferences(address);
  }
}
