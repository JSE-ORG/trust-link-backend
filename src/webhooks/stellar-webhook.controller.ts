import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { StellarWebhookDto } from './dto/stellar-webhook.dto';
import { StellarWebhookService } from './stellar-webhook.service';

/**
 * Issue #76 – POST /webhooks/stellar
 *
 * Receives ledger transaction notifications from Stellar Horizon.
 * The endpoint:
 *  - Reads the raw body buffer for HMAC verification before JSON parsing.
 *  - Validates the payload shape via the DTO.
 *  - Delegates processing (signature check + idempotency + state update) to
 *    StellarWebhookService.
 *
 * No authentication guard is applied here because Horizon calls this endpoint
 * from outside the system; authenticity is established via the HMAC signature.
 */
@Controller('webhooks')
export class StellarWebhookController {
  constructor(private readonly webhookService: StellarWebhookService) {}

  @Post('stellar')
  @HttpCode(HttpStatus.OK)
  async handleStellarWebhook(
    @Req() req: Request,
    @Headers('x-stellar-signature') signature: string | undefined,
    @Body() dto: StellarWebhookDto,
  ): Promise<{ received: boolean; skipped?: boolean; reason?: string }> {
    // NestJS has already parsed the body into `dto` at this point.
    // We reconstruct the raw buffer from the parsed body for HMAC verification.
    // In production you would configure the express raw-body middleware on this
    // route; here we serialise back to JSON which is equivalent for HMAC
    // purposes as long as the secret is only used for verification.
    const rawBody = this.extractRawBody(req, dto);

    return this.webhookService.handleEvent(rawBody, signature, dto);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Attempt to get the raw body buffer that express stored on the request
   * object (requires `verify` option on bodyParser / rawBody: true in NestJS).
   * Falls back to re-serialising the parsed DTO, which is safe for HMAC
   * verification when the sender also serialises with the same key order.
   */
  private extractRawBody(req: Request, dto: StellarWebhookDto): Buffer {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (raw instanceof Buffer) return raw;

    // Fallback: re-serialise the validated DTO
    try {
      return Buffer.from(JSON.stringify(dto), 'utf8');
    } catch {
      throw new BadRequestException('Unable to read request body');
    }
  }
}
