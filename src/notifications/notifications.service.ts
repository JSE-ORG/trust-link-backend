import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  EscrowRecord,
  NotificationType,
  PrismaService,
} from '../prisma/prisma.service';
import { SENDGRID_CLIENT, TWILIO_CLIENT } from './notifications.tokens';
import { decryptContact } from '../common/sanitization/contact-encryption.util';

interface SendGridClient {
  send(message: Record<string, unknown>): Promise<unknown>;
}

interface TwilioClient {
  messages: {
    create(message: Record<string, unknown>): Promise<{ sid?: string }>;
  };
}

const noopSendGrid: SendGridClient = {
  send: () => Promise.resolve(undefined),
};
const noopTwilio: TwilioClient = {
  messages: { create: () => Promise.resolve({ sid: undefined }) },
};

const MAX_ATTEMPTS = 3;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(SENDGRID_CLIENT)
    private readonly sendGrid: SendGridClient = noopSendGrid,
    @Optional()
    @Inject(TWILIO_CLIENT)
    private readonly twilio: TwilioClient = noopTwilio,
  ) {}

  /** Notifies the vendor that escrow funding has been recorded. */
  notifyFunded(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('FUNDED', escrow, escrow.vendorAddress);
  }

  /**
   * Notifies the buyer that the vendor marked the escrow as shipped.
   * Prefers the stored buyer contact (email/phone) over the Stellar address
   * so the buyer actually receives the notification at a real channel.
   */
  notifyShipped(escrow: EscrowRecord): Promise<void> {
    return this.dispatchToBuyer('SHIPPED', escrow);
  }

  /**
   * Notifies the buyer that delivery has been recorded for the escrow.
   * Prefers stored buyer contact over Stellar address.
   */
  notifyDelivered(escrow: EscrowRecord): Promise<void> {
    return this.dispatchToBuyer('DELIVERED', escrow);
  }

  /** Notifies the vendor that a dispute has been opened. */
  notifyDisputed(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('DISPUTED', escrow, escrow.vendorAddress);
  }

  /** Notifies the configured admin address that a dispute needs attention. */
  notifyDisputedAdmin(
    escrow: EscrowRecord,
    adminAddress: string,
  ): Promise<void> {
    return this.dispatch('DISPUTED', escrow, adminAddress);
  }

  /**
   * Notifies the buyer that escrow funds have been released/completed.
   * Prefers stored buyer contact over Stellar address.
   */
  notifyCompleted(escrow: EscrowRecord): Promise<void> {
    return this.dispatchToBuyer('COMPLETED', escrow);
  }

  /**
   * Notifies the buyer that escrow funds have been refunded.
   * Prefers stored buyer contact over Stellar address.
   */
  notifyRefunded(escrow: EscrowRecord): Promise<void> {
    return this.dispatchToBuyer('REFUNDED', escrow);
  }

  // ── Issue #28 ─────────────────────────────────────────────────────────────

  /**
   * Resolves the buyer's real contact info from the encrypted fields on the
   * escrow record and dispatches to whichever channel(s) are available.
   *
   * Resolution order:
   *  1. Decrypt buyerContactEmail  → send email to that address
   *  2. Decrypt buyerContactPhone  → send SMS to that number
   *  3. Neither stored             → fall back to buyerAddress (Stellar key)
   *     so the notification record is still written, even if undeliverable.
   *
   * Decryption failures are caught and logged rather than thrown — a bad
   * ciphertext should not block state transitions that triggered the notify.
   */
  private async dispatchToBuyer(
    type: NotificationType,
    escrow: EscrowRecord,
  ): Promise<void> {
    const escrowData = escrow as EscrowRecord & {
      buyerContactEmail?: string | null;
      buyerContactPhone?: string | null;
    };
    const resolvedEmail = this.tryDecrypt(
      escrowData.buyerContactEmail ?? null,
      escrow.id,
      'email',
    );
    const resolvedPhone = this.tryDecrypt(
      escrowData.buyerContactPhone ?? null,
      escrow.id,
      'phone',
    );

    if (resolvedEmail) {
      await this.dispatchEmail(type, escrow, resolvedEmail);
    }

    if (resolvedPhone) {
      await this.dispatchSms(type, escrow, resolvedPhone);
    }

    if (!resolvedEmail && !resolvedPhone) {
      // No contact info stored yet — fall back to Stellar address so the
      // notification row is still written for audit purposes.
      this.logger.warn(
        `No buyer contact info for escrow ${escrow.id} — falling back to Stellar address`,
      );
      await this.dispatch(type, escrow, escrow.buyerAddress);
    }
  }

  /**
   * Attempts to decrypt a stored contact value.
   * Returns the plaintext on success, null on any failure.
   */
  private tryDecrypt(
    stored: string | null,
    escrowId: string,
    field: 'email' | 'phone',
  ): string | null {
    if (!stored) return null;
    try {
      return decryptContact(stored);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt buyer ${field} for escrow ${escrowId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ── Internal dispatch ─────────────────────────────────────────────────────

  private async dispatch(
    type: NotificationType,
    escrow: EscrowRecord,
    recipientAddress: string,
  ): Promise<void> {
    await this.dispatchEmail(type, escrow, recipientAddress);
    await this.dispatchSms(type, escrow, recipientAddress);
  }

  private async dispatchEmail(
    type: NotificationType,
    escrow: EscrowRecord,
    recipientAddress: string,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    let providerMessageId: string | null = null;
    let attemptCount = 0;
    let lastResponseCode: number | null = null;

    while (attemptCount < MAX_ATTEMPTS) {
      attemptCount++;
      try {
        this.logger.log(
          `Dispatching SendGrid ${type} [attempt ${attemptCount}/${MAX_ATTEMPTS}, Request-ID: ${requestId}]`,
        );
        const response = await this.sendGrid.send({
          to: recipientAddress,
          templateId: `trustlink-${type.toLowerCase()}`,
          dynamicTemplateData: {
            escrowId: escrow.id,
            itemName: escrow.itemName,
          },
          headers: { 'X-Request-ID': requestId },
        });
        providerMessageId = this.extractProviderId(response);
        lastResponseCode = this.extractSuccessCode(response);
        break;
      } catch (error) {
        lastResponseCode = this.extractResponseCode(error);
        if (attemptCount < MAX_ATTEMPTS) {
          const delayMs = 1000 * Math.pow(2, attemptCount - 1);
          this.logger.warn(
            `SendGrid ${type} attempt ${attemptCount}/${MAX_ATTEMPTS} failed ` +
              `(status: ${lastResponseCode ?? 'unknown'}) — retrying in ${delayMs}ms ` +
              `[Request-ID: ${requestId}]`,
          );
          await this.sleep(delayMs);
        } else {
          this.logger.error(
            `SendGrid ${type} notification failed after ${MAX_ATTEMPTS} attempts [Request-ID: ${requestId}]`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    await this.prisma.notification.create({
      data: {
        escrowId: escrow.id,
        type,
        channel: 'EMAIL',
        recipientAddress,
        message: `${type}: ${escrow.itemName}`,
        providerMessageId,
        attemptCount,
        lastResponseCode,
      },
    });
  }

  private async dispatchSms(
    type: NotificationType,
    escrow: EscrowRecord,
    recipientAddress: string,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    let providerMessageId: string | null = null;
    let attemptCount = 0;
    let lastResponseCode: number | null = null;

    while (attemptCount < MAX_ATTEMPTS) {
      attemptCount++;
      try {
        this.logger.log(
          `Dispatching Twilio ${type} [attempt ${attemptCount}/${MAX_ATTEMPTS}, Request-ID: ${requestId}]`,
        );
        const response = await this.twilio.messages.create({
          to: recipientAddress,
          body: `${type}: ${escrow.itemName}`,
        });
        providerMessageId = response.sid ?? null;
        break;
      } catch (error) {
        lastResponseCode = this.extractResponseCode(error);
        if (attemptCount < MAX_ATTEMPTS) {
          const delayMs = 1000 * Math.pow(2, attemptCount - 1);
          this.logger.warn(
            `Twilio ${type} attempt ${attemptCount}/${MAX_ATTEMPTS} failed ` +
              `(status: ${lastResponseCode ?? 'unknown'}) — retrying in ${delayMs}ms ` +
              `[Request-ID: ${requestId}]`,
          );
          await this.sleep(delayMs);
        } else {
          this.logger.error(
            `Twilio ${type} notification failed after ${MAX_ATTEMPTS} attempts [Request-ID: ${requestId}]`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    await this.prisma.notification.create({
      data: {
        escrowId: escrow.id,
        type,
        channel: 'SMS',
        recipientAddress,
        message: `${type}: ${escrow.itemName}`,
        providerMessageId,
        attemptCount,
        lastResponseCode,
      },
    });
  }

  /** Resolves after `ms` milliseconds. Extracted for test spying. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractProviderId(response: unknown): string | null {
    if (
      Array.isArray(response) &&
      typeof response[0] === 'object' &&
      response[0] !== null &&
      'headers' in response[0]
    ) {
      const headers = (response[0] as { headers?: Record<string, string> })
        .headers;
      return headers?.['x-message-id'] ?? null;
    }
    return null;
  }

  private extractSuccessCode(response: unknown): number | null {
    if (
      Array.isArray(response) &&
      typeof response[0] === 'object' &&
      response[0] !== null
    ) {
      const r = response[0] as Record<string, unknown>;
      if (typeof r.statusCode === 'number') return r.statusCode;
    }
    return null;
  }

  private extractResponseCode(error: unknown): number | null {
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      if (typeof e.code === 'number') return e.code;
      if (typeof e.status === 'number') return e.status;
      const res = e.response;
      if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>;
        if (typeof r.statusCode === 'number') return r.statusCode;
        if (typeof r.status === 'number') return r.status;
      }
    }
    return null;
  }
}
