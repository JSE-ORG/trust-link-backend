import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import Redis from 'ioredis';

/** Maximum number of entries held by the in-memory fallback cache. */
const MAX_MEMORY_ENTRIES = 1_000;

/** How often (in ms) the periodic sweep removes expired entries from the fallback. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Issue #103 – Thin Redis wrapper used for response caching.
 *
 * When REDIS_URL is not configured the service operates as a no-op so
 * development and test environments work without a Redis instance.
 *
 * #506 – The in-memory fallback now runs a periodic sweep to evict expired
 * entries and enforces a maximum size (MAX_MEMORY_ENTRIES).  When the map
 * reaches capacity, the entry with the closest (soonest) expiry is removed
 * to make room for the new value.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis | null;
  private readonly memory = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(@Optional() configService?: ConfigService) {
    const redisUrl = configService?.get('REDIS_URL') ?? process.env.REDIS_URL;
    if (redisUrl) {
      this.client = new Redis(redisUrl, { lazyConnect: true });
      this.client.on('error', (err: Error) =>
        this.logger.error('Redis connection error', err.message),
      );
      this.client
        .connect()
        .catch((err: Error) =>
          this.logger.error('Redis connect failed', err.message),
        );
    } else {
      this.client = null;
      this.logger.warn('REDIS_URL not set — using in-memory fallback cache');
      this.startSweeper();
    }
  }

  // ── Periodic sweep ─────────────────────────────────────────────────────────

  private startSweeper(): void {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  private stopSweeper(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Removes every entry whose TTL has expired.  Idempotent — safe to call concurrently. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (now > entry.expiresAt) {
        this.memory.delete(key);
      }
    }
  }

  /** Evicts entries until the map is below MAX_MEMORY_ENTRIES.
   *  Removes the soonest-to-expire entries first. */
  private evictToCapacity(): void {
    if (this.memory.size <= MAX_MEMORY_ENTRIES) return;

    const sorted = [...this.memory.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    const toDelete = this.memory.size - MAX_MEMORY_ENTRIES;
    for (let i = 0; i < toDelete; i++) {
      this.memory.delete(sorted[i][0]);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Reads a cached JSON value from Redis or the in-memory fallback, returning null on miss. */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) {
      const entry = this.memory.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        this.memory.delete(key);
        return null;
      }
      return entry.value as T;
    }
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err: unknown) {
      this.logger.error(
        `cache.get failed for key ${key}`,
        (err as Error).message,
      );
      return null;
    }
  }

  /**
   * Stores `value` (JSON-serialised) under `key` with a `ttlSeconds` expiry
   * (default 60s), in Redis when configured or the in-memory fallback
   * otherwise.
   *
   * Best-effort and never throws: a Redis failure is logged and swallowed,
   * so a cache outage degrades to cache-miss behaviour rather than breaking
   * the request. `value` must be JSON-serialisable — functions, `undefined`
   * properties and `BigInt` will not round-trip through {@link get}. On the
   * in-memory path a write may evict the oldest entries to stay under the
   * capacity cap.
   */
  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    if (!this.client) {
      this.memory.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      this.evictToCapacity();
      return;
    }
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err: unknown) {
      this.logger.error(
        `cache.set failed for key ${key}`,
        (err as Error).message,
      );
    }
  }

  /**
   * Liveness probe for the Redis connection (issue #31, used by GET /health).
   * Returns:
   *   - 'disabled' when REDIS_URL is not configured (caching intentionally off),
   *   - 'ok'       when the server replies to PING,
   *   - 'down'     when a configured Redis is unreachable.
   */
  async ping(): Promise<'ok' | 'down' | 'disabled'> {
    if (!this.client) return 'disabled';
    try {
      const reply = await this.client.ping();
      return reply === 'PONG' ? 'ok' : 'down';
    } catch (err: unknown) {
      this.logger.error('cache.ping failed', (err as Error).message);
      return 'down';
    }
  }

  /**
   * Removes `key` from Redis (or the in-memory fallback). Used to invalidate
   * a cached read after a write to the underlying record.
   *
   * Idempotent — deleting a missing key is a no-op, not an error. Like
   * {@link set} it is best-effort: a Redis failure is logged and swallowed,
   * which means a failed invalidation can leave a stale entry served until
   * its TTL lapses. Deletes a single exact key only; there is no prefix or
   * pattern delete.
   */
  async del(key: string): Promise<void> {
    if (!this.client) {
      this.memory.delete(key);
      return;
    }
    try {
      await this.client.del(key);
    } catch (err: unknown) {
      this.logger.error(
        `cache.del failed for key ${key}`,
        (err as Error).message,
      );
    }
  }

  /** Closes the Redis client and stops the sweeper timer during Nest shutdown. */
  async onModuleDestroy(): Promise<void> {
    this.stopSweeper();
    this.memory.clear();
    await this.client?.quit();
  }
}
