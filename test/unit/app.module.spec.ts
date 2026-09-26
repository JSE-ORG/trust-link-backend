import 'reflect-metadata';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';

function getThrottlerFactory(): (config: ConfigService) => { ttl: number; limit: number }[] {
  const imports: unknown[] = (Reflect.getMetadata('imports', AppModule) as unknown[]) ?? [];
  const throttlerDynamic = imports.find(
    (m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && (m as Record<string, unknown>).module === ThrottlerModule,
  ) as Record<string, unknown> | undefined;

  if (!throttlerDynamic) throw new Error('ThrottlerModule dynamic import not found in AppModule');

  const providers = (throttlerDynamic.providers as Array<Record<string, unknown>>) ?? [];
  const optionsProvider = providers.find((p) => typeof p?.useFactory === 'function');

  if (!optionsProvider) throw new Error('ThrottlerModule options provider not found');

  return optionsProvider.useFactory as (config: ConfigService) => { ttl: number; limit: number }[];
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

    const [throttler] = factory(mockConfig);

    expect(throttler.ttl).toBe(30000);
    expect(throttler.limit).toBe(100);
  });

  it('falls back to 60000ms ttl and 60 limit when PUBLIC_WINDOW and PUBLIC_LIMIT are unset', () => {
    const factory = getThrottlerFactory();
    const mockConfig = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const [throttler] = factory(mockConfig);

    expect(throttler.ttl).toBe(60000);
    expect(throttler.limit).toBe(60);
  });
});
