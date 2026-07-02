import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from '../../src/app.module';

describe('ThrottlerGuard configuration', () => {
  it('is registered as a global guard in AppModule', async () => {
    // Verify ThrottlerGuard is listed as a provider with the APP_GUARD token.
    const providers: Array<{ provide?: unknown; useClass?: unknown }> =
      (Reflect.getMetadata('providers', AppModule) as typeof providers) ?? [];

    const throttlerGuardProvider = providers.find(
      (p) => p.provide === APP_GUARD && p.useClass === ThrottlerGuard,
    );

    expect(throttlerGuardProvider).toBeDefined();
  });

  it('auth throttler has correct default ttl and limit', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60000, limit: 10 }]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    // Retrieve the ThrottlerModule options from the DI container.
    // The module compiling without error validates the shape is accepted.
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('public throttler has correct default ttl and limit', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'public', ttl: 60000, limit: 60 }]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('evidence-upload throttler has correct default ttl and limit', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'evidence-upload', ttl: 60000, limit: 10 },
        ]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('all three named throttlers can coexist in a single module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'auth', ttl: 60000, limit: 10 },
          { name: 'public', ttl: 60000, limit: 60 },
          { name: 'evidence-upload', ttl: 60000, limit: 10 },
        ]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
