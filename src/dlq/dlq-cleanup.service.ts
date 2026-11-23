import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '../config/config.service';
import { FailedTransactionRepository } from './failed-transaction.repository';

/** Daily cleanup for resolved dead-letter queue entries (issue #1214). */
@Injectable()
export class DlqCleanupService {
  private readonly logger = new Logger(DlqCleanupService.name);

  constructor(
    private readonly failedTransactions: FailedTransactionRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Prunes resolved (REPLAYED or ABANDONED) DLQ entries older than the configured retention days.
   */
  @Cron('0 0 * * *')
  async pruneResolvedFailedTransactions(): Promise<void> {
    const retentionDays = this.configService.get<number>('DLQ_RETENTION_DAYS');
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    this.logger.log('Starting resolved DLQ record prune');
    const result = await this.failedTransactions.pruneResolvedOlderThan(cutoff);
    this.logger.log(
      `DLQ prune completed: ${result.count} resolved records deleted (older than ${retentionDays} days)`,
    );
  }
}
