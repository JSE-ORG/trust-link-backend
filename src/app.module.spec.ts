/**
 * Unit tests for `AppModule` and the `ThrottlerModule` options it wires up.
 *
 * Consolidated from `src/app.module.spec.ts` and `test/unit/app.module.spec.ts`
 * (issue #852). The former contributed the DI-container compilation smoke test;
 * the latter contributed the throttler `useFactory` coverage. Both live here
 * now, so `AppModule` has exactly one spec next to its source.
 *
 * The throttler factory is read straight off `AppModule`'s `imports` metadata
 * rather than rebuilt, so these tests break if the wiring changes.
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppModule, buildThrottlerOptions } from './app.module';
import { ConfigService } from './config/config.service';

describe('AppModule', () => {
  it('compiles the DI container without errors', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 30_000);
});

function getThrottlerFactory(): (
  config: ConfigService,
) => ReturnType<typeof buildThrottlerOptions> {
  const imports: unknown[] =
    (Reflect.getMetadata('imports', AppModule) as unknown[]) ?? [];
  const throttlerDynamic = imports.find(
    (m): m is Record<string, unknown> =>
      typeof m === 'object' &&
      m !== null &&
      (m as Record<string, unknown>).module === ThrottlerModule,
  );

  if (!throttlerDynamic)
    throw new Error('ThrottlerModule dynamic import not found in AppModule');

  const providers =
    (throttlerDynamic.providers as Array<Record<string, unknown>>) ?? [];
  const optionsProvider = providers.find(
    (p) => typeof p?.useFactory === 'function',
  );

  if (!optionsProvider)
    throw new Error('ThrottlerModule options provider not found');

  return optionsProvider.useFactory as (
    config: ConfigService,
  ) => ReturnType<typeof buildThrottlerOptions>;
}

describe('AppModule throttler useFactory', () => {
  it('uses configured PUBLIC_WINDOW and PUBLIC_LIMIT values', () => {
    const factory = getThrottlerFactory();
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'PUBLIC_WINDOW') return 30000;
        if (key === 'PUBLIC_LIMIT') return 100;
        return undefined;
      }),
    } as unknown as ConfigService;

    const options = factory(mockConfig);
    const [throttler] = options.throttlers ?? [];

    expect(throttler.ttl).toBe(30000);
    expect(throttler.limit).toBe(100);
  });

  it('falls back to 60000ms ttl and 60 limit when PUBLIC_WINDOW and PUBLIC_LIMIT are unset', () => {
    const factory = getThrottlerFactory();
    const mockConfig = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const options = factory(mockConfig);
    const [throttler] = options.throttlers ?? [];

    expect(throttler.ttl).toBe(60000);
    expect(throttler.limit).toBe(60);
  });

  it('uses in-memory throttler storage when REDIS_URL is unset', () => {
    const options = buildThrottlerOptions({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    expect(options.storage).toBeUndefined();
  });

  it('uses Redis throttler storage when REDIS_URL is set', () => {
    const options = buildThrottlerOptions({
      get: jest.fn((key: string) =>
        key === 'REDIS_URL' ? 'redis://localhost:6379/0' : undefined,
      ),
    } as unknown as ConfigService);

    expect(options.storage).toBeInstanceOf(ThrottlerStorageRedisService);
    (options.storage as ThrottlerStorageRedisService).onModuleDestroy();
  });
});
