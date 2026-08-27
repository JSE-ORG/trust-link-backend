import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  VendorProfileRecord,
  VendorTrackingSettingsRecord,
} from '../prisma/prisma.service';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationPreferencesResponseDto } from './dto/notification-preferences-response.dto';
import { VendorProfileRepository } from './vendor-profile.repository';

@Injectable()
export class VendorProfileService {
  constructor(private readonly repository: VendorProfileRepository) {}

  /**
   * Creates the vendor profile for `address`, failing with
   * `ConflictException` if one already exists.
   *
   * This is the strict "first registration" path — not idempotent, and not
   * safe to blindly retry after a success (the retry 409s). Callers that
   * want create-or-replace semantics should use {@link upsertProfile}.
   */
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

  /**
   * Creates the vendor profile for `address`, or replaces it if it already
   * exists. Unlike {@link createProfile} this never conflicts, so it is the
   * idempotent, retry-safe entry point.
   *
   * Takes a full `CreateVendorProfileDto` (not a partial), so an update
   * through this path overwrites the whole profile with the DTO's values
   * rather than patching individual fields — use {@link updateProfile} for a
   * partial change.
   */
  async upsertProfile(
    address: string,
    dto: CreateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.repository.upsert(address, dto);
  }

  /**
   * Returns the vendor profile for `address`, throwing `NotFoundException`
   * when there is none. There is no nullable variant of this read — a
   * missing profile is always an error here.
   */
  async getProfile(address: string): Promise<VendorProfileRecord> {
    const profile = await this.repository.findByAddress(address);
    if (!profile) {
      throw new NotFoundException('Vendor profile not found');
    }
    return profile;
  }

  /**
   * Applies a partial update to an existing vendor profile.
   *
   * Two guards run before any write, in this order: (1) at least one field
   * on `dto` is defined, else `BadRequestException` ("No update fields
   * provided") — a PATCH with an empty body is rejected rather than treated
   * as a no-op; (2) the profile exists, else `NotFoundException`. Only the
   * defined keys of `dto` are sent to the repository; `undefined` keys are
   * left as-is on the stored record.
   */
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

  /**
   * Updates the vendor's notification preferences (the tracking-settings
   * side of the profile), returning the resulting `trackingSettings`.
   *
   * Same two-guard order as {@link updateProfile}: an all-`undefined` `dto`
   * throws `BadRequestException`, then a missing profile throws
   * `NotFoundException`. The underlying repository call creates the tracking
   * settings row if the profile has none yet, so a first-time preference set
   * succeeds without a separate create step.
   */
  async updateNotificationPreferences(
    address: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<{ trackingSettings: VendorTrackingSettingsRecord }> {
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

  /**
   * Returns the vendor's effective notification preferences: stored values
   * where set, platform defaults where not.
   *
   * The response is always fully populated — a vendor with no tracking
   * settings row still gets a complete object of defaults rather than
   * `null`/partial. Unlike {@link updateNotificationPreferences} this does
   * not require the profile to exist and does not throw for a missing one;
   * it is a safe read for rendering a settings screen.
   */
  async getNotificationPreferences(
    address: string,
  ): Promise<NotificationPreferencesResponseDto> {
    return this.repository.findNotificationPreferences(address);
  }
}
