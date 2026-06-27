import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Request } from 'express';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  cleanupIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  limit: 60,
  windowMs: 60_000,
  cleanupIntervalMs: 60_000,
};

/**
 * In-memory request-rate limiter that purges expired buckets on a fixed
 * interval. Without the timer the backing Map grew unbounded under
 * sustained load (issue #247).
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly store = new Map<string, number[]>();
  private readonly options: Required<RateLimitOptions>;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(options: Partial<RateLimitOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      this.options.cleanupIntervalMs,
    );
    // Don't keep the event loop alive solely for the cleanup heartbeat.
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = this.resolveKey(req);
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    const recent = (this.store.get(key) ?? []).filter((ts) => ts > windowStart);
    if (recent.length >= this.options.limit) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    recent.push(now);
    this.store.set(key, recent);
    return true;
  }

  /** Removes timestamps older than the window and drops empty buckets. */
  cleanup(now: number = Date.now()): void {
    const windowStart = now - this.options.windowMs;
    let droppedKeys = 0;
    for (const [key, timestamps] of this.store) {
      const fresh = timestamps.filter((ts) => ts > windowStart);
      if (fresh.length === 0) {
        this.store.delete(key);
        droppedKeys++;
      } else if (fresh.length !== timestamps.length) {
        this.store.set(key, fresh);
      }
    }
    if (droppedKeys > 0) {
      this.logger.debug(
        `RateLimitGuard cleanup removed ${droppedKeys} expired bucket(s)`,
      );
    }
  }

  /** Exposed for tests and observability — current number of tracked buckets. */
  size(): number {
    return this.store.size;
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private resolveKey(req: Request): string {
    return (
      (req.ip as string | undefined) ??
      (req.socket?.remoteAddress as string | undefined) ??
      'unknown'
    );
  }
}
