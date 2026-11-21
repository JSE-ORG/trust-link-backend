import { Injectable } from '@nestjs/common';
import { NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginatedEnvelope } from '../common/pagination/pagination.helper';

export interface CreateNotificationInput {
  escrowId: string;
  type: string;
  channel: 'EMAIL' | 'SMS';
  recipientAddress: string;
  message: string;
  providerMessageId?: string | null;
  attemptCount?: number;
  lastResponseCode?: number | null;
}

/**
 * Owns every `notification` query (R-DB-02, issue #845).
 *
 * Notification delivery records are written from two places — the dispatch
 * paths in `NotificationsService` and the retry workers in
 * `NotificationRetryQueueService` — and the retry workers additionally stamp
 * status transitions. Keeping those writes here means neither service has to
 * reach for `PrismaService`, and the "what counts as SENT / FAILED" rules live
 * in one file rather than being restated at six call sites.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records the outcome of a delivery attempt once the provider call has run
   * (successfully or not). `providerMessageId` / `lastResponseCode` are the
   * provider's own identifiers, nullable when the call never got that far.
   */
  create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        escrowId: input.escrowId,
        type: input.type,
        channel: input.channel,
        recipientAddress: input.recipientAddress,
        message: input.message,
        providerMessageId: input.providerMessageId ?? null,
        attemptCount: input.attemptCount ?? 0,
        lastResponseCode: input.lastResponseCode ?? null,
      },
    });
  }

  /**
   * Marks a notification delivered, stamping `sentAt` and recording how many
   * retries it took (0 when the first attempt succeeded).
   */
  markSent(id: string, retryCount: number) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        retryCount,
      },
    });
  }

  /**
   * Records a failed attempt without ending the notification: the row keeps
   * whatever status it had so the retry queue can pick it back up, and
   * `retryCount` / `lastError` explain what happened.
   */
  markAttemptFailed(id: string, retryCount: number, lastError: string) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        retryCount,
        failedAt: new Date(),
        lastError,
      },
    });
  }

  /**
   * Marks a notification terminally `FAILED` — the retry budget is spent.
   */
  markFailed(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        status: 'FAILED',
      },
    });
  }

  /**
   * Returns a paginated list of notification history for a vendor's escrows.
   * Deliberately excludes recipientAddress, message, and lastError to protect privacy.
   */
  async findVendorHistory(
    vendorAddress: string,
    query?: {
      page?: number;
      limit?: number;
      status?: NotificationStatus;
      escrowId?: string;
    },
  ) {
    const rawPage = query?.page;
    const rawLimit = query?.limit;

    const page =
      typeof rawPage === 'number' && Number.isFinite(rawPage)
        ? Math.max(1, Math.floor(rawPage))
        : 1;

    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
        : 20;

    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      escrow: {
        vendorAddress,
      },
    };

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.escrowId) {
      where.escrowId = query.escrowId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          escrowId: true,
          type: true,
          channel: true,
          status: true,
          attemptCount: true,
          sentAt: true,
          failedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return buildPaginatedEnvelope(rows, total, page, limit);
  }

  /**
   * Returns a paginated list of notifications for administrators.
   * Returns lastError and lastResponseCode, but never recipientAddress or message.
   */
  async findAdminNotifications(query?: {
    page?: number;
    limit?: number;
    status?: NotificationStatus;
    channel?: string;
    type?: string;
    from?: string;
    to?: string;
  }) {
    const rawPage = query?.page;
    const rawLimit = query?.limit;

    const page =
      typeof rawPage === 'number' && Number.isFinite(rawPage)
        ? Math.max(1, Math.floor(rawPage))
        : 1;

    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
        : 20;

    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {};

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.channel) {
      where.channel = query.channel;
    }
    if (query?.type) {
      where.type = query.type;
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (query?.from) {
      dateFilter.gte = new Date(query.from);
    }
    if (query?.to) {
      dateFilter.lte = new Date(query.to);
    }
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          escrowId: true,
          type: true,
          channel: true,
          status: true,
          retryCount: true,
          attemptCount: true,
          lastError: true,
          lastResponseCode: true,
          providerMessageId: true,
          sentAt: true,
          failedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return buildPaginatedEnvelope(rows, total, page, limit);
  }
}
