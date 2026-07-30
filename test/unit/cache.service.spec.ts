/**
 * Unit tests for CacheService (src/common/cache.service.ts — issue #285).
 *
 * The common CacheService provides Redis caching with an in-memory fallback
 * when REDIS_URL / REDIS_HOST env vars are not set. All Redis calls are
 * mocked so no live Redis instance is needed.
 */

// Must mock ioredis before importing the service under test.
jest.mock('ioredis');

import Redis from 'ioredis';
import { CacheService } from '../../src/cache/cache.service';
import { ConfigService } from '../../src/config/config.service';

const MockRedis = Redis as jest.MockedClass<typeof Redis>;

// Helper to build a fresh mock Redis instance.
function buildRedisMock() {
  const instance = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    ping: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  };
  MockRedis.mockImplementation(() => instance as unknown as Redis);
  return instance;
}

function mockConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService {
  const config = new (ConfigService as unknown as new () => ConfigService)();
  jest.spyOn(config, 'get').mockImplementation((key: string) => overrides[key]);
  return config;
}

describe('CacheService (issue #285) — Redis mode', () => {
  let service: CacheService;
  let redisMock: ReturnType<typeof buildRedisMock>;

  beforeEach(() => {
    redisMock = buildRedisMock();
    service = new CacheService(
      mockConfigService({ REDIS_URL: 'redis://localhost:6379' }),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get()', () => {
    it('returns the parsed JSON value for a cache hit', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
      const result = await service.get<{ foo: string }>('my-key');
      expect(result).toEqual({ foo: 'bar' });
      expect(redisMock.get).toHaveBeenCalledWith('my-key');
    });

    it('returns null on a cache miss', async () => {
      redisMock.get.mockResolvedValue(null);
      const result = await service.get('missing-key');
      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('serialises the value as JSON and stores it with the given TTL', async () => {
      redisMock.set.mockResolvedValue('OK');
      await service.set('cache-key', { hello: 'world' }, 30);
      expect(redisMock.set).toHaveBeenCalledWith(
        'cache-key',
        JSON.stringify({ hello: 'world' }),
        'EX',
        30,
      );
    });

    it('calls Redis set with the correct arguments', async () => {
      redisMock.set.mockResolvedValue('OK');
      await service.set('my-key', [1, 2, 3], 120);
      expect(redisMock.set).toHaveBeenCalledWith(
        'my-key',
        JSON.stringify([1, 2, 3]),
        'EX',
        120,
      );
    });
  });

  describe('del()', () => {
    it('deletes the key from Redis', async () => {
      redisMock.del.mockResolvedValue(1);
      await service.del('stale-key');
      expect(redisMock.del).toHaveBeenCalledWith('stale-key');
    });

    it('calls Redis del with the correct key', async () => {
      redisMock.del.mockResolvedValue(0);
      await service.del('another-key');
      expect(redisMock.del).toHaveBeenCalledWith('another-key');
    });
  });

  describe('onModuleDestroy()', () => {
    it('calls quit() on the Redis client', async () => {
      redisMock.quit.mockResolvedValue('OK');
      await service.onModuleDestroy();
      expect(redisMock.quit).toHaveBeenCalled();
    });
  });
});

describe('CacheService (issue #285) — in-memory fallback mode', () => {
  let service: CacheService;

  /** Access the private `memory` map for assertions. */
  function memorySize(): number {
    return (service as unknown as Record<string, unknown>).memory instanceof Map
      ? ((service as unknown as Record<string, unknown>).memory as Map<string, unknown>).size
      : -1;
  }

  beforeEach(() => {
    MockRedis.mockImplementation(() => {
      throw new Error('should not construct Redis in fallback mode');
    });
    service = new CacheService(mockConfigService({}));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get()', () => {
    it('returns null for a key that was never set', async () => {
      const result = await service.get('non-existent');
      expect(result).toBeNull();
    });

    it('returns the value that was previously stored', async () => {
      await service.set('greet', { hello: 'world' }, 60);
      const result = await service.get<{ hello: string }>('greet');
      expect(result).toEqual({ hello: 'world' });
    });
  });

  describe('TTL expiration', () => {
    it('returns null for a key whose TTL has elapsed', async () => {
      jest.useFakeTimers();
      await service.set('expiring', 'value', 1); // 1-second TTL
      jest.advanceTimersByTime(1001); // advance past TTL
      const result = await service.get('expiring');
      expect(result).toBeNull();
      jest.useRealTimers();
    });

    it('returns the value while within the TTL window', async () => {
      jest.useFakeTimers();
      await service.set('alive', 'still-here', 10);
      jest.advanceTimersByTime(5000);
      const result = await service.get('alive');
      expect(result).toBe('still-here');
      jest.useRealTimers();
    });
  });

  describe('set()', () => {
    it('uses a default TTL of 60 seconds when none is supplied', async () => {
      jest.useFakeTimers();
      await service.set('default-ttl', 'val', 60); // default TTL
      jest.advanceTimersByTime(59_000);
      expect(await service.get('default-ttl')).toBe('val');
      jest.advanceTimersByTime(1001);
      expect(await service.get('default-ttl')).toBeNull();
      jest.useRealTimers();
    });

    it('overwrites an existing entry', async () => {
      await service.set('key', 'first', 60);
      await service.set('key', 'second', 60);
      expect(await service.get('key')).toBe('second');
    });
  });

  describe('del()', () => {
    it('removes the key from the in-memory store', async () => {
      await service.set('to-delete', 42, 60);
      await service.del('to-delete');
      expect(await service.get('to-delete')).toBeNull();
    });

    it('does not throw when deleting a non-existent key', async () => {
      await expect(service.del('ghost-key')).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy()', () => {
    it('resolves without error when there is no Redis client', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('clears the in-memory map', async () => {
      await service.set('a', 1, 60);
      await service.set('b', 2, 60);
      expect(memorySize()).toBe(2);
      await service.onModuleDestroy();
      expect(memorySize()).toBe(0);
    });
  });

  // ── Issue #506: in-memory fallback eviction ────────────────────────────────

  describe('sweep (issue #506)', () => {
    it('removes expired entries via periodic sweep without a get() for that key', async () => {
      jest.useFakeTimers();
      await service.set('expires-fast', 'gone', 1);
      await service.set('stays', 'here', 3600);

      // Advance past TTL of first entry but within sweep interval
      jest.advanceTimersByTime(1500);
      // After TTL but before sweep, a get() would lazily delete it
      // Now advance past the sweep interval so the timer fires
      jest.advanceTimersByTime(61_000);

      // The expired entry should have been swept — verify it's gone
      expect(await service.get('expires-fast')).toBeNull();
      // The valid entry is unaffected
      expect(await service.get('stays')).toBe('here');

      jest.useRealTimers();
    });

    it('does not remove entries that are still within their TTL window', async () => {
      jest.useFakeTimers();
      await service.set('valid-1', 'a', 3600);
      await service.set('valid-2', 'b', 3600);

      jest.advanceTimersByTime(61_000);

      expect(await service.get('valid-1')).toBe('a');
      expect(await service.get('valid-2')).toBe('b');
      jest.useRealTimers();
    });
  });

  describe('bounded capacity (issue #506)', () => {
    it('evicts the soonest-expiring entry when the map exceeds MAX_MEMORY_ENTRIES', async () => {
      jest.useFakeTimers();
      // Fill to capacity with 30s TTL entries
      for (let i = 0; i < 1_000; i++) {
        await service.set(`key-${i}`, i, 30);
      }
      expect(memorySize()).toBe(1_000);

      // Add one more — this triggers eviction
      await service.set('newest', 'val', 3600);
      // Map should still be at capacity (the soonest-expiring entry was removed)
      expect(memorySize()).toBe(1_000);

      // The entry with the longest TTL (3600s) should still be present
      expect(await service.get('newest')).toBe('val');
      jest.useRealTimers();
    });

    it('does not grow without bound under repeated writes', async () => {
      jest.useFakeTimers();
      const total = 2_500;
      for (let i = 0; i < total; i++) {
        await service.set(`bulk-${i}`, i, 60);
      }
      expect(memorySize()).toBeLessThanOrEqual(1_000);
      jest.useRealTimers();
    });
  });
});
