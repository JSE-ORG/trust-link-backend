import { Injectable } from '@nestjs/common';
import { PrismaService, VendorProfileRecord } from '../prisma/prisma.service';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationPreferencesResponseDto } from './dto/notification-preferences-response.dto';

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
  ): Promise<{ trackingSettings: Record<string, unknown> }> {
    // Upsert VendorTrackingSettings to ensure it exists
    const trackingSettings = await this.prisma.vendorTrackingSettings.upsert({
      where: { vendorAddress: address },
      create: {
        vendorAddress: address,
        notifyOnDelivery: dto.notifyOnDelivery ?? true,
        notifyOnDelay: dto.notifyOnDelay ?? true,
        notifyOnException: dto.notifyOnException ?? true,
        notificationChannels: dto.notificationChannels ?? ['EMAIL'],
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

    return { trackingSettings };
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
      notificationChannels: settings?.notificationChannels ?? ['EMAIL'],
      webhookUrl: settings?.webhookUrl ?? null,
      enableTracking: settings?.enableTracking ?? true,
      delayThresholdHours: settings?.delayThresholdHours ?? 24,
      deliveryConfirmation: settings?.deliveryConfirmation ?? true,
      trackingHistoryRetentionDays:
        settings?.trackingHistoryRetentionDays ?? 90,
    };
  }
}
