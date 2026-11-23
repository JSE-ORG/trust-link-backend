import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaService,
  VendorProfileRecord,
  VendorTrackingSettingsRecord,
  toVendorTrackingSettingsRecord,
} from '../prisma/prisma.service';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationPreferencesResponseDto } from './dto/notification-preferences-response.dto';
import { DEFAULT_NOTIFICATION_CHANNELS } from './vendor.constants';
import { VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION } from './vendor-profile.constants';

@Injectable()
export class VendorProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a new vendor profile linked to the given Stellar address. */
  create(
    address: string,
    dto: CreateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.prisma.vendorProfile.create({
      data: {
        address,
        businessName: dto.businessName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        description: dto.description ?? null,
      },
    });
  }

  /** Returns the vendor profile for the given Stellar address, or null if not registered. */
  findByAddress(address: string): Promise<VendorProfileRecord | null> {
    return this.prisma.vendorProfile.findUnique({ where: { address } });
  }

  /** Creates or updates a vendor profile — safe to call without checking existence first. */
  upsert(
    address: string,
    dto: CreateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.prisma.vendorProfile.upsert({
      where: { address },
      create: {
        address,
        businessName: dto.businessName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        description: dto.description ?? null,
      },
      update: {
        businessName: dto.businessName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        description: dto.description ?? null,
      },
    });
  }

  /**
   * Ensures the foreign-key parent exists without overwriting an existing
   * profile.
   */
  ensurePlaceholder(address: string): Promise<VendorProfileRecord> {
    return this.prisma.vendorProfile.upsert({
      where: { address },
      create: {
        address,
        businessName: address,
        description: VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION,
      },
      update: {},
    });
  }

  /** Updates mutable fields on the vendor profile identified by address. */
  update(
    address: string,
    dto: UpdateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.prisma.vendorProfile.update({
      where: { address },
      data: dto,
    });
  }

  /** Updates notification preferences for the vendor, creating tracking settings if they don't exist. */
  async updateNotificationPreferences(
    address: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<{ trackingSettings: VendorTrackingSettingsRecord }> {
    // Upsert VendorTrackingSettings to ensure it exists
    const trackingSettings = await this.prisma.vendorTrackingSettings.upsert({
      where: { vendorAddress: address },
      create: {
        vendorAddress: address,
        notifyOnDelivery: dto.notifyOnDelivery ?? true,
        notifyOnDelay: dto.notifyOnDelay ?? true,
        notifyOnException: dto.notifyOnException ?? true,
        notificationChannels: dto.notificationChannels ?? [
          ...DEFAULT_NOTIFICATION_CHANNELS,
        ],
        webhookUrl: dto.webhookUrl ?? null,
        webhookSecret: dto.webhookSecret ?? null,
      },
      update: {
        ...(dto.notifyOnDelivery !== undefined && {
          notifyOnDelivery: dto.notifyOnDelivery,
        }),
        ...(dto.notifyOnDelay !== undefined && {
          notifyOnDelay: dto.notifyOnDelay,
        }),
        ...(dto.notifyOnException !== undefined && {
          notifyOnException: dto.notifyOnException,
        }),
        ...(dto.notificationChannels !== undefined && {
          notificationChannels: dto.notificationChannels,
        }),
        ...(dto.webhookUrl !== undefined && {
          webhookUrl: dto.webhookUrl,
        }),
        ...(dto.webhookSecret !== undefined && {
          webhookSecret: dto.webhookSecret,
        }),
      },
    });

    return {
      trackingSettings: toVendorTrackingSettingsRecord(trackingSettings),
    };
  }

  /** Returns notification preferences for the vendor, falling back to platform defaults if not configured. */
  async findNotificationPreferences(
    address: string,
  ): Promise<NotificationPreferencesResponseDto> {
    const settings = await this.prisma.vendorTrackingSettings.findUnique({
      where: { vendorAddress: address },
    });

    return {
      notifyOnDelivery: settings?.notifyOnDelivery ?? true,
      notifyOnDelay: settings?.notifyOnDelay ?? true,
      notifyOnException: settings?.notifyOnException ?? true,
      notificationChannels: settings?.notificationChannels ?? [
        ...DEFAULT_NOTIFICATION_CHANNELS,
      ],
      webhookUrl: settings?.webhookUrl ?? null,
      enableTracking: settings?.enableTracking ?? true,
      delayThresholdHours: settings?.delayThresholdHours ?? 24,
      deliveryConfirmation: settings?.deliveryConfirmation ?? true,
      trackingHistoryRetentionDays:
        settings?.trackingHistoryRetentionDays ?? 90,
    };
  }

  /**
   * Paged list of vendors for admin dashboard with escrow counts (#1152).
   * Aggregates escrow, completed, and disputed counts in a single query across all returned vendors.
   */
  async listVendorsForAdmin(params: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{
    data: Array<{
      address: string;
      businessName: string | null;
      createdAt: Date;
      escrowCount: number;
      completedCount: number;
      disputedCount: number;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.max(1, Math.min(100, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.VendorProfileWhereInput = {};
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { address: { contains: q, mode: 'insensitive' } },
        { businessName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [vendors, total] = await Promise.all([
      this.prisma.vendorProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendorProfile.count({ where }),
    ]);

    const vendorAddresses = vendors.map((v) => v.address);

    const countsMap = new Map<
      string,
      { escrowCount: number; completedCount: number; disputedCount: number }
    >();
    for (const addr of vendorAddresses) {
      countsMap.set(addr, {
        escrowCount: 0,
        completedCount: 0,
        disputedCount: 0,
      });
    }

    if (vendorAddresses.length > 0) {
      const grouped = await this.prisma.escrow.groupBy({
        by: ['vendorAddress', 'state'],
        where: {
          vendorAddress: { in: vendorAddresses },
        },
        _count: { _all: true },
      });

      for (const row of grouped) {
        const stats = countsMap.get(row.vendorAddress);
        if (stats) {
          const count = row._count._all;
          stats.escrowCount += count;
          if (row.state === 'COMPLETED' || row.state === 'RELEASED') {
            stats.completedCount += count;
          }
          if (row.state === 'DISPUTED') {
            stats.disputedCount += count;
          }
        }
      }
    }

    const data = vendors.map((v) => {
      const stats = countsMap.get(v.address) ?? {
        escrowCount: 0,
        completedCount: 0,
        disputedCount: 0,
      };
      return {
        address: v.address,
        businessName: v.businessName,
        createdAt: v.createdAt,
        escrowCount: stats.escrowCount,
        completedCount: stats.completedCount,
        disputedCount: stats.disputedCount,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
