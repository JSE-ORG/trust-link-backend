import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '../config/config.service';
import { StellarWebhookRepository } from './stellar-webhook.repository';
import { MILLISECONDS_PER_DAY } from '../common/constants/time.constants';

/**
 * Daily job that prunes processed Stellar webhook event ids past the replay
 * window (issue #962).
 *
 * Runs at midnight UTC (`0 0 * * *`). Deletes `ProcessedWebhookEvent` rows
 * whose `processedAt` is older than `WEBHOOK_EVENT_RETENTION_DAYS` (default
 * 30 days). The retention window is configurable via environment variable so
 * operators can align it with their replay/reconciliation needs.
 */
@Injectable()
export class WebhookCleanupService {
  private readonly logger = new Logger(WebhookCleanupService.name);

  constructor(
    private readonly webhookRepository: StellarWebhookRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Prunes processed webhook events older than the configured retention days.
   */
  @Cron('0 0 * * *')
  async pruneProcessedWebhookEvents(): Promise<void> {
    const retentionDays = this.configService.get<number>(
      'WEBHOOK_EVENT_RETENTION_DAYS',
    );
    const cutoff = new Date(Date.now() - retentionDays * MILLISECONDS_PER_DAY);

    this.logger.log('Starting processed webhook event prune');

    const result = await this.webhookRepository.pruneOlderThan(cutoff);

    this.logger.log(
      `Webhook prune completed: ${result.count} processed webhook events deleted (older than ${retentionDays} days)`,
    );
  }
}
