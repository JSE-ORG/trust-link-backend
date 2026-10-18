import { forwardRef, Module } from '@nestjs/common';
import { EscrowModule } from '../escrow/escrow.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConfigModule } from '../config/config.module';
import { StellarWebhookController } from './stellar-webhook.controller';
import { StellarWebhookService } from './stellar-webhook.service';
import { StellarWebhookRepository } from './stellar-webhook.repository';
import { WebhookCleanupService } from './webhook-cleanup.service';

/**
 * Issue #76 – Webhooks module.
 *
 * Registers the Stellar Horizon webhook endpoint and its processing service.
 * EscrowModule is imported so the service can update escrow state on confirmed
 * deposits.
 */
@Module({
  imports: [forwardRef(() => EscrowModule), NotificationsModule, ConfigModule],
  controllers: [StellarWebhookController],
  providers: [StellarWebhookService, StellarWebhookRepository, WebhookCleanupService],
  exports: [StellarWebhookService],
})
export class WebhooksModule {}
