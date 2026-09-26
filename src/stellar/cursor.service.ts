import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TracingService } from '../tracing/tracing.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracing: TracingService,
  ) {}

  /**
   * Runs `fn` inside a Stellar span.
   *
   * Spans here carry identifiers such as the contract escrow id, the network,
   * and the contract function. Signing secrets, secret keys and full
   * transaction envelopes are never recorded as attributes.
   */
  private traced<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    return this.tracing.withSpan(name, { attributes }, fn);
  }

  /**
   * Read the persisted cursor value. Returns `undefined` when no cursor has
   * been stored yet (first run).
   */
  async get(): Promise<string | undefined> {
    return this.traced('stellar.cursor.get', {}, () => this.getInternal());
  }

  private async getInternal(): Promise<string | undefined> {
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
    return this.traced('stellar.cursor.set', {}, () =>
      this.setInternal(cursorValue),
    );
  }

  private async setInternal(cursorValue: string): Promise<void> {
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
