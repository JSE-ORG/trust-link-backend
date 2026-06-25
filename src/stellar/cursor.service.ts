import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Issue #306 – Database-backed cursor persistence for the blockchain listener.
 *
 * Replaces the file-based cursor (data/stellar_cursor.txt) with Prisma-backed
 * storage so the cursor survives container restarts and deployments.
 */
@Injectable()
export class CursorService {
  private readonly logger = new Logger(CursorService.name);
  private static readonly CURSOR_KEY = 'stellar-listener';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the persisted cursor value. Returns `undefined` when no cursor has
   * been stored yet (first run).
   */
  async get(): Promise<string | undefined> {
    try {
      const record = await this.prisma.cursor.findFirst({
        where: { id: CursorService.CURSOR_KEY },
      });
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
    try {
      await this.prisma.cursor.upsert({
        where: { id: CursorService.CURSOR_KEY },
        update: { cursorValue },
        create: { id: CursorService.CURSOR_KEY, cursorValue },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to persist cursor to DB: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
