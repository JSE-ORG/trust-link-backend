import { Module } from '@nestjs/common';
import { EscrowModule } from '../escrow/escrow.module';
import { StellarWebhookController } from './stellar-webhook.controller';
import { StellarWebhookService } from './stellar-webhook.service';

/**
 * Issue #76 – Webhooks module.
 *
 * Registers the Stellar Horizon webhook endpoint and its processing service.
 * EscrowModule is imported so the service can update escrow state on confirmed
 * deposits.
 */
@Module({
  imports: [EscrowModule],
  controllers: [StellarWebhookController],
  providers: [StellarWebhookService],
})
export class WebhooksModule {}
