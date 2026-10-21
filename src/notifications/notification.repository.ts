import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
