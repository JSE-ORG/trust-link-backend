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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { StellarWebhookDto } from './dto/stellar-webhook.dto';
import { StellarWebhookService } from './stellar-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class StellarWebhookController {
  constructor(private readonly webhookService: StellarWebhookService) {}

  /**
   * Receives and processes Stellar Horizon ledger event webhooks.
   * Validates the HMAC signature and routes the event to the
   * appropriate handler. Duplicate events are detected and skipped.
   *
   * @param req - Raw Express request with body buffer for signature verification
   * @param signature - HMAC signature from x-stellar-signature header
   * @param dto - Stellar webhook event payload
   * @returns Processing result with received status and optional skip reason
   * @throws BadRequestException if raw body is unavailable or payload is invalid
   * @authentication None (HMAC signature verification instead)
   */
  @ApiOperation({ summary: 'Receive Stellar Horizon ledger event webhook' })
  @ApiResponse({ status: 200, description: 'Webhook event processed.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload or missing HMAC signature.',
  })
  @Post('stellar')
  @HttpCode(HttpStatus.OK)
  async handleStellarWebhook(
    @Req() req: Request,
    @Headers('x-stellar-signature') signature: string | undefined,
    @Body() dto: StellarWebhookDto,
  ): Promise<{ received: boolean; skipped?: boolean; reason?: string }> {
    const rawBody = this.extractRawBody(req);
    return this.webhookService.handleEvent(rawBody, signature, dto);
  }

  private extractRawBody(req: Request): Buffer {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (raw instanceof Buffer) return raw;

    throw new BadRequestException('Unable to read raw request body');
  }
}
