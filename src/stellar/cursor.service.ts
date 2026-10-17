import { Injectable, Logger } from '@nestjs/common';
import { CursorRepository } from './cursor.repository';
import { TracingService } from '../tracing/tracing.service';

/**
 * Issue #306 – Database-backed cursor persistence for the blockchain listener.
 *
 * Replaces the old file-based cursor with Prisma-backed storage so the cursor
 * survives container restarts and deployments.
 */
@Injectable()
export class CursorService {
  private readonly logger = new Logger(CursorService.name);
  public static readonly DEFAULT_KEY = 'stellar-listener';
  public static readonly SOROBAN_POLLER_KEY = 'soroban-poller';

  constructor(
    private readonly cursorRepository: CursorRepository,
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
  async get(key: string = CursorService.DEFAULT_KEY): Promise<string | undefined> {
    return this.traced('stellar.cursor.get', {}, () => this.getInternal(key));
  }

  private async getInternal(key: string): Promise<string | undefined> {
    try {
      const record = await this.cursorRepository.findById(key);
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
  async set(cursorValue: string, key: string = CursorService.DEFAULT_KEY): Promise<void> {
    return this.traced('stellar.cursor.set', {}, () =>
      this.setInternal(cursorValue, key),
    );
  }

  private async setInternal(cursorValue: string, key: string): Promise<void> {
    try {
      await this.cursorRepository.upsert(key, cursorValue);
    } catch (err) {
      this.logger.warn(
        'Failed to persist cursor to DB: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
