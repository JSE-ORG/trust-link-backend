import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationPreferences,
  VendorProfile,
} from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateVendorProfileDto,
  UpdateNotificationPreferencesDto,
  UpdateVendorProfileDto,
} from './dto/vendor-profile.dto';

@Injectable()
export class VendorService {
  constructor(private readonly prisma: PrismaService) {}

  async createProfile(
    dto: CreateVendorProfileDto,
    vendorAddress: string,
  ): Promise<VendorProfile> {
    try {
      return await this.prisma.vendorProfile.create({
        data: { ...dto, vendorAddress, contactPhone: dto.contactPhone ?? null },
      });
    } catch (err: unknown) {
      if (this.isDuplicateError(err)) {
        throw new ConflictException(
          'A profile already exists for this vendor address',
        );
      }
      throw err;
    }
  }

  async getProfile(vendorAddress: string): Promise<VendorProfile> {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { vendorAddress },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found');
    return profile;
  }

  async replaceProfile(
    dto: CreateVendorProfileDto,
    vendorAddress: string,
  ): Promise<VendorProfile> {
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { vendorAddress },
    });
    if (!existing) throw new NotFoundException('Vendor profile not found');
    return this.prisma.vendorProfile.update({
      where: { vendorAddress },
      data: {
        businessName: dto.businessName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone ?? null,
      },
    });
  }

  async patchProfile(
    dto: UpdateVendorProfileDto,
    vendorAddress: string,
  ): Promise<VendorProfile> {
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { vendorAddress },
    });
    if (!existing) throw new NotFoundException('Vendor profile not found');
    return this.prisma.vendorProfile.update({
      where: { vendorAddress },
      data: dto,
    });
  }

  async getNotificationPreferences(
    vendorAddress: string,
  ): Promise<NotificationPreferences> {
    const profile = await this.getProfile(vendorAddress);
    return profile.notificationPreferences;
  }

  async patchNotificationPreferences(
    dto: UpdateNotificationPreferencesDto,
    vendorAddress: string,
  ): Promise<NotificationPreferences> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one preference field is required');
    }
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { vendorAddress },
    });
    if (!existing) throw new NotFoundException('Vendor profile not found');
    const updated = await this.prisma.vendorProfile.update({
      where: { vendorAddress },
      data: { notificationPreferences: dto },
    });
    return updated.notificationPreferences;
  }

  /**
   * Return daily volume time-series for a vendor's escrows (issue #290).
   * Groups completed/released escrow amounts by creation date (UTC day).
   */
  async getAnalyticsChart(
    vendorAddress: string,
  ): Promise<{ date: string; volume: number }[]> {
    const escrows = await this.prisma.escrow.findMany({
      where: { vendorAddress },
    });

    const byDay = new Map<string, number>();
    for (const escrow of escrows) {
      const day = escrow.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + escrow.amount);
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, volume]) => ({ date, volume }));
  }

  private isDuplicateError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    );
  }
}
