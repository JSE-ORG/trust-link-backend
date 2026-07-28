import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '../config/config.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import { PrismaService } from '../prisma/prisma.service';
import { StellarWebhookDto } from './dto/stellar-webhook.dto';

/**
 * Issue #76 – Stellar Horizon webhook processing.
 * Issue #77 – Cursor persistence: processed operation IDs are stored in the
 *             database so deduplication survives service restarts.
 *
 * Responsibilities:
 *  1. Verify the HMAC-SHA256 signature supplied by Horizon so only genuine
 *     callbacks are accepted.
 *  2. Deduplicate events using the operation `id` field – Horizon may retry
 *     delivery across restarts, so the cursor is persisted in PostgreSQL.
 *  3. On a verified deposit confirmation, find the matching escrow by the
 *     destination address and update its state.
 */
@Injectable()
export class StellarWebhookService {
  private readonly logger = new Logger(StellarWebhookService.name);
  private readonly processedIds = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly escrowRepository: EscrowRepository,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Verify the webhook signature and process the payload.
   *
   * @param rawBody   The raw request body bytes (needed for HMAC verification).
   * @param signature The value of the `X-Stellar-Signature` header.
   * @param dto       The parsed + validated payload.
   */
  async handleEvent(
    rawBody: Buffer,
    signature: string | undefined,
    dto: StellarWebhookDto,
  ): Promise<{ received: boolean; skipped?: boolean; reason?: string }> {
    try {
      this.verifySignature(rawBody, signature);

      // --- Idempotency check (DB-backed, survives restarts) ------------------
      const duplicate = this.prisma
        ? await this.prisma.processedWebhookEvent.findUnique({
            where: { operationId: dto.id },
          })
        : this.processedIds.has(dto.id);
      if (duplicate) {
        this.logger.log(
          JSON.stringify({
            msg: 'stellar.webhook.duplicate',
            operationId: dto.id,
          }),
        );
        return { received: true, skipped: true, reason: 'duplicate' };
      }

      // Persist before processing so concurrent Horizon retries are blocked.
      if (this.prisma) {
        await this.prisma.processedWebhookEvent.create({
          data: { operationId: dto.id },
        });
      } else {
        this.processedIds.add(dto.id);
      }

      try {
        await this.processEvent(dto);
      } catch (err) {
        // Roll back the cursor so the event can be retried on the next delivery.
        if (this.prisma) {
          await this.prisma.processedWebhookEvent.delete({
            where: { operationId: dto.id },
          });
        } else {
          this.processedIds.delete(dto.id);
        }
        throw err;
      }

      return { received: true };
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          msg: 'stellar.webhook.processing_failed',
          eventType: dto.type,
          operationId: dto.id,
          txHash: dto.transaction_hash,
          error: err instanceof Error ? err.message : String(err),
        }),
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  /**
   * Programmatic processing for replayed operations (no signature verification).
   * Returns true when processed, false when skipped (duplicate).
   */
  /** Processes replayed operations without signature checks while guarding duplicates. */
  async processOperationDto(
    dto: StellarWebhookDto,
  ): Promise<{ processed: boolean; skipped?: boolean }> {
    if (this.processedIds.has(dto.id)) {
      this.logger.log(
        JSON.stringify({
          msg: 'stellar.replay.duplicate',
          operationId: dto.id,
        }),
      );
      return { processed: false, skipped: true };
    }

    this.processedIds.add(dto.id);
    try {
      await this.processEvent(dto);
    } catch (err) {
      this.processedIds.delete(dto.id);
      this.logger.error(
        JSON.stringify({
          msg: 'stellar.replay.processing_failed',
          eventType: dto.type,
          operationId: dto.id,
          txHash: dto.transaction_hash,
          error: err instanceof Error ? err.message : String(err),
        }),
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }

    return { processed: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Verify HMAC-SHA256 signature.
   *
   * Horizon signs the raw body with the shared secret and sends the hex digest
   * in the `X-Stellar-Signature` header.  Production deployments MUST configure
   * STELLAR_WEBHOOK_SECRET — when the secret is missing the request is rejected
   * immediately because there is no way to trust the caller.
   */
  private verifySignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): void {
    const secret = this.configService.get('STELLAR_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error(
        JSON.stringify({
          msg: 'stellar.webhook.secret_missing',
          reason: 'STELLAR_WEBHOOK_SECRET is not configured — rejecting request',
        }),
      );
      throw new InternalServerErrorException(
        'Webhook secret not configured',
      );
    }

    if (!signature) {
      throw new UnauthorizedException('Missing X-Stellar-Signature header');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const expBuffer = Buffer.from(expected, 'hex');

    if (
      sigBuffer.length !== expBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  /**
   * Route the event to the appropriate handler based on `type`.
   */
  private async processEvent(dto: StellarWebhookDto): Promise<void> {
    this.logger.log(
      JSON.stringify({
        msg: 'stellar.webhook.received',
        type: dto.type,
        operationId: dto.id,
        txHash: dto.transaction_hash,
      }),
    );

    switch (dto.type) {
      case 'payment':
        await this.handlePayment(dto);
        break;

      default:
        this.logger.log(
          JSON.stringify({
            msg: 'stellar.webhook.unhandled_type',
            type: dto.type,
          }),
        );
    }
  }

  /**
   * Handle an incoming payment operation.
   *
   * Issue #396 – the lookup previously used `findByBuyer(dto.to)` which is
   * wrong on two counts:
   *   1. `dto.to` is the *destination* (vendor/recipient) address, not the
   *      buyer address.  The correct lookup is `findByVendor(dto.to)`.
   *   2. The filter selected already-FUNDED escrows and wrote FUNDED again
   *      (no-op).  We must require the escrow to be in CREATED so only
   *      pending escrows are advanced.
   *
   * Additionally, neither the payment amount nor the asset was validated,
   * allowing partial or wrong-asset payments to fund an escrow silently.
   * Both are now verified before the state transition.
   *
   * Decision on overpayment: reject it.  Accepting a higher amount would
   * leave excess funds in the contract with no defined reclaim path and
   * could mask a payment directed to the wrong escrow.  The buyer must
   * send the exact amount.
   */
  private async handlePayment(dto: StellarWebhookDto): Promise<void> {
    if (!dto.to) {
      throw new BadRequestException(
        'Payment event missing destination address',
      );
    }

    // dto.to is the Horizon "destination" field – i.e. the vendor's Stellar
    // address that the buyer paid into.  We therefore look up by vendorAddress.
    const escrows = await this.escrowRepository.findByVendor(dto.to);

    // Only advance escrows that are still awaiting payment.
    const pending = escrows.filter((e) => e.state === 'CREATED');

    if (pending.length === 0) {
      this.logger.log(
        JSON.stringify({
          msg: 'stellar.webhook.no_matching_escrow',
          to: dto.to,
          txHash: dto.transaction_hash,
        }),
      );
      return;
    }

    // In practice there should be at most one CREATED escrow per vendor
    // address at any given time, but we iterate defensively.
    for (const escrow of pending) {
      // ── Amount validation ────────────────────────────────────────────────
      // The escrow amount is a Prisma Decimal; convert to a plain number for
      // comparison.  We require an exact match: underpayments leave the escrow
      // underfunded, and overpayments are rejected (see method-level comment).
      const expectedAmount = Number(escrow.amount);
      const receivedAmount =
        dto.amount !== undefined ? Number(dto.amount) : NaN;

      if (isNaN(receivedAmount) || receivedAmount !== expectedAmount) {
        this.logger.warn(
          JSON.stringify({
            msg: 'stellar.webhook.amount_mismatch',
            escrowId: escrow.id,
            expected: expectedAmount,
            received: dto.amount,
            txHash: dto.transaction_hash,
          }),
        );
        continue;
      }

      // ── Asset validation ─────────────────────────────────────────────────
      // escrow.currency holds the asset code (e.g. "USDC").  Native XLM
      // payments omit asset_code in the Horizon payload; we treat a missing
      // asset_code as "XLM" and compare case-insensitively.
      const expectedAsset = escrow.currency.toUpperCase();
      const receivedAsset = (dto.asset_code ?? 'XLM').toUpperCase();

      if (receivedAsset !== expectedAsset) {
        this.logger.warn(
          JSON.stringify({
            msg: 'stellar.webhook.asset_mismatch',
            escrowId: escrow.id,
            expected: expectedAsset,
            received: dto.asset_code,
            txHash: dto.transaction_hash,
          }),
        );
        continue;
      }

      // ── State transition ─────────────────────────────────────────────────
      await this.escrowRepository.updateState(escrow.id, 'FUNDED');

      this.logger.log(
        JSON.stringify({
          msg: 'stellar.webhook.deposit_confirmed',
          escrowId: escrow.id,
          txHash: dto.transaction_hash,
          amount: dto.amount,
          assetCode: dto.asset_code,
        }),
      );
    }
  }
}
