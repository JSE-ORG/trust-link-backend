import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';
import { StellarWebhookDto } from '../webhooks/dto/stellar-webhook.dto';
import { StellarWebhookService } from '../webhooks/stellar-webhook.service';
import { CursorService } from './cursor.service';

@Injectable()
export class EventReplayService implements OnModuleInit {
  private readonly logger = new Logger(EventReplayService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly webhookService: StellarWebhookService,
    private readonly cursorService: CursorService,
  ) {}

  /** Replays recent Horizon operations from the persisted cursor on startup. */
  async onModuleInit(): Promise<void> {
    try {
      const network = this.config.get('STELLAR_NETWORK') || 'TESTNET';
      const horizon =
        network === 'MAINNET'
          ? 'https://horizon.stellar.org'
          : 'https://horizon-testnet.stellar.org';

      const cursor = await this.cursorService.get();

      const url = `${horizon}/operations?order=asc&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      this.logger.log(`EventReplay fetching operations from ${url}`);
      const res = await axios.get(url, { timeout: 15000 });
      const records = res.data._embedded?.records ?? [];

      for (const rec of records) {
        const dto: StellarWebhookDto = {
          id: String(rec.id),
          type: String(rec.type),
          transaction_hash: String(rec.transaction_hash ?? ''),
          to: rec.to,
          amount: rec.amount,
          asset_code: rec.asset_code,
        };

        try {
          await this.webhookService.processOperationDto(dto);
        } catch (err) {
          this.logger.error('Failed to process replayed op', err);
        }
      }

      // Persist cursor atomically after processing all records
      if (records.length > 0) {
        const lastRec = records[records.length - 1];
        const newCursor = String(lastRec.paging_token || lastRec.id);
        await this.cursorService.set(newCursor);
      }

      this.logger.log(`Event replay processed ${records.length} operations`);
    } catch (err) {
      this.logger.warn(
        'Event replay failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
