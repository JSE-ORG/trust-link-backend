import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '../config/config.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import { StellarWebhookDto } from './dto/stellar-webhook.dto';

/**
 * Issue #76 – Stellar Horizon webhook processing.
 *
 * Responsibilities:
 *  1. Verify the HMAC-SHA256 signature supplied by Horizon so only genuine
 *     callbacks are accepted.
 *  2. Deduplicate events using the operation `id` field – Horizon may retry
 *     delivery, so we must be idempotent.
 *  3. On a verified deposit confirmation, find the matching escrow by the
 *     destination address and update its state.
 */
@Injectable()
export class StellarWebhookService {
  private readonly logger = new Logger(StellarWebhookService.name);

  /**
   * In-process idempotency store.
   * For production use this should be backed by Redis or a DB table, but the
   * in-memory set is sufficient for the scope of this issue and keeps the
   * implementation free of external dependencies.
   */
  private readonly processedIds = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly escrowRepository: EscrowRepository,
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
    this.verifySignature(rawBody, signature);

    // --- Idempotency check ---------------------------------------------------
    if (this.processedIds.has(dto.id)) {
      this.logger.log(
        JSON.stringify({
          msg: 'stellar.webhook.duplicate',
          operationId: dto.id,
        }),
      );
      return { received: true, skipped: true, reason: 'duplicate' };
    }

    // Mark as seen *before* processing so concurrent retries are also blocked.
    this.processedIds.add(dto.id);

    try {
      await this.processEvent(dto);
    } catch (err) {
      // Remove from the set so the event can be retried on the next delivery.
      this.processedIds.delete(dto.id);
      throw err;
    }

    return { received: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Verify HMAC-SHA256 signature.
   *
   * Horizon signs the raw body with the shared secret and sends the hex digest
   * in the `X-Stellar-Signature` header.  When no secret is configured we skip
   * verification (useful for local development / tests).
   */
  private verifySignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): void {
    const secret = this.configService.get('STELLAR_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn(
        JSON.stringify({
          msg: 'stellar.webhook.signature_check_skipped',
          reason: 'STELLAR_WEBHOOK_SECRET not configured',
        }),
      );
      return;
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
   * When a buyer sends funds to a vendor's escrow address we look up the
   * matching escrow by the destination address and confirm the deposit.
   */
  private async handlePayment(dto: StellarWebhookDto): Promise<void> {
    if (!dto.to) {
      throw new BadRequestException(
        'Payment event missing destination address',
      );
    }

    // Find escrows awaiting funding for this destination address
    const escrows = await this.escrowRepository.findByBuyer(dto.to);
    const funded = escrows.filter((e) => e.state === 'FUNDED');

    if (funded.length === 0) {
      this.logger.log(
        JSON.stringify({
          msg: 'stellar.webhook.no_matching_escrow',
          to: dto.to,
          txHash: dto.transaction_hash,
        }),
      );
      return;
    }

    // Update each matching escrow – in practice there should be at most one
    for (const escrow of funded) {
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
