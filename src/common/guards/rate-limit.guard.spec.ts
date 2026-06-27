import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

function ctxFor(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress: ip } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard (#247 memory leak)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests under the limit and blocks the next one', () => {
    const guard = new RateLimitGuard({ limit: 2, windowMs: 60_000 });
    const ctx = ctxFor('1.1.1.1');

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);

    guard.onModuleDestroy();
  });

  it('purges expired entries when cleanup runs, keeping the store bounded', () => {
    const guard = new RateLimitGuard({
      limit: 10,
      windowMs: 1_000,
      cleanupIntervalMs: 60_000,
    });

    // Simulate many distinct IPs hitting once each.
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      jest.setSystemTime(start + i);
      guard.canActivate(ctxFor(`10.0.0.${i}`));
    }
    expect(guard.size()).toBe(50);

    // Jump past the window so every recorded timestamp is expired.
    jest.setSystemTime(start + 5_000);
    guard.cleanup();
    expect(guard.size()).toBe(0);

    guard.onModuleDestroy();
  });

  it('runs cleanup automatically on the configured interval', () => {
    const guard = new RateLimitGuard({
      limit: 10,
      windowMs: 1_000,
      cleanupIntervalMs: 60_000,
    });
    const cleanupSpy = jest.spyOn(guard, 'cleanup');

    jest.advanceTimersByTime(60_000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(cleanupSpy).toHaveBeenCalledTimes(2);

    guard.onModuleDestroy();
  });

  it('clears its cleanup timer on module destroy', () => {
    const guard = new RateLimitGuard({ cleanupIntervalMs: 60_000 });
    const cleanupSpy = jest.spyOn(guard, 'cleanup');

    guard.onModuleDestroy();
    jest.advanceTimersByTime(120_000);

    expect(cleanupSpy).not.toHaveBeenCalled();
  });
});
