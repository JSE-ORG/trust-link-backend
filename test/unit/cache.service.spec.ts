/* eslint-disable @typescript-eslint/unbound-method */
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
import { CacheService } from '../../src/common/cache.service';

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
  };
  MockRedis.mockImplementation(() => instance as unknown as Redis);
  return instance;
}

describe('CacheService (issue #285) — Redis mode', () => {
  let service: CacheService;
  let redisMock: ReturnType<typeof buildRedisMock>;

  beforeEach(() => {
    redisMock = buildRedisMock();
    process.env.REDIS_URL = 'redis://localhost:6379';
    service = new CacheService();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
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

  beforeEach(() => {
    // Ensure no Redis env vars are set so the service falls back to memory.
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    MockRedis.mockImplementation(() => {
      throw new Error('should not construct Redis in fallback mode');
    });
    service = new CacheService();
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
      jest.advanceTimersByTime(1001);             // advance past TTL
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
      await service.set('default-ttl', 'val'); // no explicit TTL
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
  });
});
