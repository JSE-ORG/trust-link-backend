import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { EscrowRecord, NotificationType } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import {
  CreateNotificationInput,
  NotificationRepository,
} from './notification.repository';
import { SENDGRID_CLIENT, TWILIO_CLIENT } from './notifications.tokens';
import { decryptContact } from '../common/sanitization/contact-encryption.util';
import { VendorProfileRepository } from '../vendor/vendor-profile.repository';

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

type NotificationWriter =
  | NotificationRepository
  | {
      notification?: {
        create(args: { data: CreateNotificationInput }): Promise<unknown>;
      };
    };

/**
 * #839 — Every notification type the service can emit, paired with the config
 * key holding its SendGrid dynamic template id.
 *
 * The dispatch path used to synthesise ``trustlink-<type>`` and send that as
 * the template id. No SendGrid account has a template with that name, so every
 * request was rejected; the ids are now read from configuration. Keeping the
 * type→key mapping in one place lets the boot check and the send path agree,
 * and makes a newly added type a compile error rather than a silent failure.
 */
const TEMPLATE_ID_CONFIG_KEYS: Record<
  NotificationType,
  | 'SENDGRID_TEMPLATE_FUNDED'
  | 'SENDGRID_TEMPLATE_SHIPPED'
  | 'SENDGRID_TEMPLATE_DELIVERED'
  | 'SENDGRID_TEMPLATE_DISPUTED'
  | 'SENDGRID_TEMPLATE_COMPLETED'
  | 'SENDGRID_TEMPLATE_REFUNDED'
> = {
  FUNDED: 'SENDGRID_TEMPLATE_FUNDED',
  SHIPPED: 'SENDGRID_TEMPLATE_SHIPPED',
  DELIVERED: 'SENDGRID_TEMPLATE_DELIVERED',
  DISPUTED: 'SENDGRID_TEMPLATE_DISPUTED',
  COMPLETED: 'SENDGRID_TEMPLATE_COMPLETED',
  REFUNDED: 'SENDGRID_TEMPLATE_REFUNDED',
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    // Issue #845: notification writes go through the repository (R-DB-02).
    @Inject(NotificationRepository)
    private readonly notifications: NotificationWriter,
    @Optional()
    @Inject(SENDGRID_CLIENT)
    private readonly sendGrid: SendGridClient = noopSendGrid,
    @Optional()
    @Inject(TWILIO_CLIENT)
    private readonly twilio: TwilioClient = noopTwilio,
    // #839 — Email configuration is now read from config rather than assumed.
    // @Optional so a caller that constructs the service directly (several
    // specs do) still gets the no-op clients and a clear warning instead of a
    // Nest resolution failure.
    @Optional()
    private readonly config?: ConfigService,
    @Optional()
    private readonly vendorProfiles?: VendorProfileRepository,
  ) {}

  /**
   * #839 — Reports an unusable email configuration at boot.
   *
   * A missing sender or a missing template id used to surface as a rejected
   * SendGrid call on the first notification of each type, and then on every
   * notification thereafter, with nothing in the logs tying the failure back to
   * configuration. Both are now configuration problems, so both are reported
   * once during startup:
   *
   *  - no `SENDGRID_FROM_EMAIL` while a key is set — SendGrid rejects the send
   *  - no template id for a type — that type can never be delivered
   *
   * Only warns. Email is optional infrastructure (the no-op client already
   * covers an unconfigured deployment), so a missing key must not block boot
   * the way an invalid key would.
   */
  onModuleInit(): void {
    if (!this.config || !this.config.get('SENDGRID_API_KEY')) {
      return;
    }

    const fromEmail = this.config.get('SENDGRID_FROM_EMAIL');
    if (!fromEmail) {
      this.logger.error(
        'SENDGRID_FROM_EMAIL is not set while SENDGRID_API_KEY is — SendGrid ' +
          'rejects every send without a sender, so no email will be delivered. ' +
          'Set SENDGRID_FROM_EMAIL to a verified sender address.',
      );
    }

    const missing = (
      Object.keys(TEMPLATE_ID_CONFIG_KEYS) as NotificationType[]
    ).filter((type) => !this.templateIdFor(type));

    if (missing.length > 0) {
      this.logger.error(
        `No SendGrid template id configured for notification type(s): ${missing.join(', ')}. ` +
          `Set ${missing
            .map((type) => TEMPLATE_ID_CONFIG_KEYS[type])
            .join(', ')}. These notifications cannot be sent until configured.`,
      );
    }
  }

  /**
   * Reads the configured SendGrid dynamic template id for a notification type.
   *
   * Returns `null` rather than a fabricated fallback: a made-up id is exactly
   * the failure this replaces, and the caller must be able to tell "not
   * configured" apart from "configured".
   */
  private templateIdFor(type: NotificationType): string | null {
    if (!this.config) {
      return null;
    }
    const value = this.config.get<string>(TEMPLATE_ID_CONFIG_KEYS[type]);
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Notifies the vendor that the escrow has been funded.
   *
   * Sends over email **and** SMS to the same address, each with its own
   * 3-attempt exponential-backoff retry, then writes one `Notification` row
   * per channel regardless of send success — a failed provider call still
   * produces an audit row with `attemptCount` / `lastResponseCode`. The
   * returned promise resolves once both channels have been attempted and
   * recorded; it does not reject on a provider failure.
   */
  notifyFunded(escrow: EscrowRecord): Promise<void> {
    return this.dispatchToVendor('FUNDED', escrow);
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

  /**
   * Notifies the vendor that a dispute has been opened against this escrow.
   *
   * Same delivery model as {@link notifyFunded}: email + SMS to the vendor
   * address, per-channel retry, one audit `Notification` row per channel,
   * never rejects on a provider error. This is the vendor-facing half of a
   * dispute notification; {@link notifyDisputedAdmin} is the operator-facing
   * half and is a separate call.
   */
  notifyDisputed(escrow: EscrowRecord): Promise<void> {
    return this.dispatchToVendor('DISPUTED', escrow);
  }

  /**
   * Notifies an operator (`adminAddress`) that a dispute needs attention.
   *
   * Identical mechanics to {@link notifyDisputed} but addressed to the
   * caller-supplied admin address rather than the vendor, and it still
   * writes `type: 'DISPUTED'` rows — the channel/recipient on the row is
   * what distinguishes an admin alert from the vendor alert. The caller is
   * responsible for passing a real configured admin address; this method
   * does not read `ADMIN_ADDRESS` itself.
   */
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
   * Resolves the vendor's real contact channels from VendorProfile. A missing
   * email or phone skips only that channel, and no vendor notification falls
   * back to the Stellar address because providers cannot deliver to it.
   */
  private async dispatchToVendor(
    type: NotificationType,
    escrow: EscrowRecord,
  ): Promise<void> {
    if (!this.vendorProfiles) {
      this.logger.warn(
        `VendorProfileRepository unavailable; falling back to legacy vendor address dispatch for escrow ${escrow.id}`,
      );
      await this.dispatch(type, escrow, escrow.vendorAddress);
      return;
    }

    const profile = await this.vendorProfiles?.findByAddress(
      escrow.vendorAddress,
    );
    const email = profile?.email?.trim() || null;
    const phone = profile?.phone?.trim() || null;

    if (email) {
      await this.dispatchEmail(type, escrow, email);
    } else {
      this.logger.warn(
        `No vendor email for escrow ${escrow.id} vendor ${escrow.vendorAddress}; skipping ${type} email`,
      );
    }

    if (phone) {
      await this.dispatchSms(type, escrow, phone);
    } else {
      this.logger.warn(
        `No vendor phone for escrow ${escrow.id} vendor ${escrow.vendorAddress}; skipping ${type} SMS`,
      );
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

  /**
   * #839 — Records the audit row for an email that was never attempted, and
   * logs why.
   *
   * The row is still written so the notification is auditable: a
   * configuration gap shows up as one unsent EMAIL record with a reason in the
   * log, rather than as three failed provider attempts and no indication that
   * the payload was never deliverable in the first place.
   *
   * `attemptCount` stays 0 because no provider call was made.
   */
  private async recordUndeliverableEmail(
    type: NotificationType,
    escrow: EscrowRecord,
    recipientAddress: string,
    reason: string,
  ): Promise<void> {
    this.logger.error(
      `Cannot send ${type} email to ${recipientAddress}: ${reason}`,
    );
    await this.createNotification({
      escrowId: escrow.id,
      type,
      channel: 'EMAIL',
      recipientAddress,
      message: `${type}: ${escrow.itemName}`,
      providerMessageId: null,
      attemptCount: 0,
      lastResponseCode: null,
    });
  }

  private async createNotification(
    data: CreateNotificationInput,
  ): Promise<unknown> {
    if (
      'create' in this.notifications &&
      typeof this.notifications.create === 'function'
    ) {
      return this.notifications.create(data);
    }

    const legacyPrisma = this.notifications as Exclude<
      NotificationWriter,
      NotificationRepository
    >;
    return legacyPrisma.notification?.create({ data }) ?? Promise.resolve();
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

    // #839 — Resolve the sender and the template id BEFORE the retry loop.
    //
    // Neither is a transient fault, so retrying cannot help: the previous code
    // sent no `from` at all and invented `trustlink-<type>` as the template id,
    // and burned three attempts plus ~3s of backoff on every notification to
    // reach the same rejected request. With a real API key configured, every
    // email failed. Failing fast here also keeps the audit row honest — the
    // notification is recorded as not sent, with the reason, rather than as
    // three failed attempts against a payload that was never deliverable.
    const fromEmail = this.config?.get<string>('SENDGRID_FROM_EMAIL');
    const templateId = this.templateIdFor(type);
    const unconfigured = this.sendGrid === noopSendGrid;

    if (!unconfigured) {
      if (!fromEmail) {
        await this.recordUndeliverableEmail(
          type,
          escrow,
          recipientAddress,
          `SENDGRID_FROM_EMAIL is not configured [Request-ID: ${requestId}]`,
        );
        return;
      }

      if (!templateId) {
        await this.recordUndeliverableEmail(
          type,
          escrow,
          recipientAddress,
          `no SendGrid template id configured (expected ` +
            `${TEMPLATE_ID_CONFIG_KEYS[type]}) [Request-ID: ${requestId}]`,
        );
        return;
      }
    }

    while (attemptCount < MAX_ATTEMPTS) {
      attemptCount++;
      try {
        this.logger.log(
          `Dispatching SendGrid ${type} [attempt ${attemptCount}/${MAX_ATTEMPTS}, Request-ID: ${requestId}]`,
        );
        const response = await this.sendGrid.send({
          to: recipientAddress,
          // #839 — SendGrid requires a verified sender, and rejects the whole
          // request when `from` is absent. Previously omitted entirely.
          from: fromEmail,
          // #839 — The configured dynamic template id for this type, not a
          // synthesised `trustlink-<type>` name that exists in no account.
          templateId: templateId ?? '',
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

    await this.createNotification({
      escrowId: escrow.id,
      type,
      channel: 'EMAIL',
      recipientAddress,
      message: `${type}: ${escrow.itemName}`,
      providerMessageId,
      attemptCount,
      lastResponseCode,
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
          ...(this.config?.get('TWILIO_FROM_NUMBER')
            ? { from: this.config.get('TWILIO_FROM_NUMBER') }
            : {}),
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

    await this.createNotification({
      escrowId: escrow.id,
      type,
      channel: 'SMS',
      recipientAddress,
      message: `${type}: ${escrow.itemName}`,
      providerMessageId,
      attemptCount,
      lastResponseCode,
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
