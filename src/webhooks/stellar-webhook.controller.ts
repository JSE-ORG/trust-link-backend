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

  @ApiOperation({ summary: 'Receive Stellar Horizon ledger event webhook' })
  @ApiResponse({ status: 200, description: 'Webhook event processed.' })
  @ApiResponse({ status: 400, description: 'Invalid payload or missing HMAC signature.' })
  @Post('stellar')
  @HttpCode(HttpStatus.OK)
  async handleStellarWebhook(
    @Req() req: Request,
    @Headers('x-stellar-signature') signature: string | undefined,
    @Body() dto: StellarWebhookDto,
  ): Promise<{ received: boolean; skipped?: boolean; reason?: string }> {
    const rawBody = this.extractRawBody(req, dto);
    return this.webhookService.handleEvent(rawBody, signature, dto);
  }

  private extractRawBody(req: Request, dto: StellarWebhookDto): Buffer {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (raw instanceof Buffer) return raw;

    try {
      return Buffer.from(JSON.stringify(dto), 'utf8');
    } catch {
      throw new BadRequestException('Unable to read request body');
    }
  }
}
