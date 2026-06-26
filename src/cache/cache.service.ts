import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import Redis from 'ioredis';

/**
 * Issue #103 – Thin Redis wrapper used for response caching.
 *
 * When REDIS_URL is not configured the service operates as a no-op so
 * development and test environments work without a Redis instance.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis | null;

  constructor(configService: ConfigService) {
    const redisUrl = configService.get('REDIS_URL');
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
      this.logger.warn('REDIS_URL not set — response caching disabled');
    }
  }

  /** Reads a cached JSON value from Redis, returning null on miss or failure. */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
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

  /** Stores a JSON-serialized value in Redis for the supplied TTL. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
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

  /** Deletes a cached Redis key when caching is enabled. */
  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (err: unknown) {
      this.logger.error(
        `cache.del failed for key ${key}`,
        (err as Error).message,
      );
    }
  }

  /** Closes the Redis client during Nest shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }
}
