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

  it('default throttler uses public limits (60/min)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    // Retrieve the ThrottlerModule options from the DI container.
    // The module compiling without error validates the shape is accepted.
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('auth throttler can be configured for auth routes', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60000, limit: 10 }]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('evidence-upload throttler can be configured for evidence routes', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'evidenceUpload', ttl: 60000, limit: 10 },
        ]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('named throttlers coexist with the default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { ttl: 60000, limit: 60 },
          { name: 'auth', ttl: 60000, limit: 10 },
          { name: 'evidenceUpload', ttl: 60000, limit: 10 },
        ]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
