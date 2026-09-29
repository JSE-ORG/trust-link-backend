import { Injectable, Logger } from '@nestjs/common';
import { CursorRepository } from './cursor.repository';

/**
 * Issue #306 – Database-backed cursor persistence for the blockchain listener.
 *
 * Replaces the old file-based cursor with Prisma-backed storage so the cursor
 * survives container restarts and deployments.
 */
@Injectable()
export class CursorService {
  private readonly logger = new Logger(CursorService.name);
  private static readonly CURSOR_KEY = 'stellar-listener';

  constructor(private readonly cursorRepository: CursorRepository) {}

  /**
   * Read the persisted cursor value. Returns `undefined` when no cursor has
   * been stored yet (first run).
   */
  async get(): Promise<string | undefined> {
    return this.traced('stellar.cursor.get', {}, () => this.getInternal());
  }

  private async getInternal(): Promise<string | undefined> {
    try {
      const record = await this.cursorRepository.findById(
        CursorService.CURSOR_KEY,
      );
      return record?.cursorValue ?? undefined;
    } catch (err) {
      this.logger.warn(
        'Failed to read cursor from DB: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      return undefined;
    }
  }

  /**
   * Atomically upsert the cursor value. Called after each successful event
   * batch processing so the listener can resume from the last processed
   * position after a restart.
   */
  async set(cursorValue: string): Promise<void> {
    return this.traced('stellar.cursor.set', {}, () =>
      this.setInternal(cursorValue),
    );
  }

  private async setInternal(cursorValue: string): Promise<void> {
    try {
      await this.cursorRepository.upsert(CursorService.CURSOR_KEY, cursorValue);
    } catch (err) {
      this.logger.warn(
        'Failed to persist cursor to DB: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
