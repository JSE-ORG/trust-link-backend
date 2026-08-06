import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeysController } from '../../src/admin/api-keys/api-keys.controller';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { AdminGuard } from '../../src/admin/guards/admin.guard';
import { ConfigService } from '../../src/config/config.service';
import { RotateApiKeyDto } from '../../src/admin/api-keys/dto/rotate-api-key.dto';
import { bearer } from '../auth-helper';

const encryptionKeyConfig = {
  get: (key: string) =>
    key === 'CREDENTIAL_ENCRYPTION_KEY' ? 'a'.repeat(64) : undefined,
} as ConfigService;

describe('ApiKeysController (issue #410)', () => {
  let app: INestApplication;
  // Issue #548: this used to be a hand-built mock asserting on
  // setApiKey/setEncryptedApiKey/reencryptCredential — internals
  // rotateLogisticsKey stopped calling after the #498/#499 rotation
  // rewrite (rotateApiKey now does its own encryptCredential + optional
  // Prisma upsert inline, and reencryptCredential is dead code — nothing
  // in src/ calls it). A real LogisticsService instance, same as the
  // "issue #498" describe block below, tests the controller against
  // actual current behaviour instead of a stale internal API shape.
  let logisticsService: LogisticsService;

  // Issue #548: a real Stellar-format address that is deliberately not
  // process.env.ADMIN_ADDRESS, so the non-admin case exercises AdminGuard's
  // address comparison rather than merely sending an unparseable value that
  // JwtGuard would reject on its own.
  const NON_ADMIN_ADDRESS =
    'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

  beforeEach(async () => {
    logisticsService = new LogisticsService(undefined, encryptionKeyConfig);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        { provide: LogisticsService, useValue: logisticsService },
        JwtGuard,
        AdminGuard,
        // Issue #548: the previous mock returned the same literal
        // ('admin-address') for every key, including SEP10_JWT_SECRET —
        // which meant JwtGuard verified signatures against 'admin-address'
        // instead of the real SEP10_JWT_SECRET that bearer() signs with, so
        // every "real" token would have failed verification too. Reading
        // through to process.env (loaded from .env.test by
        // test/setup-env.ts) gives JwtGuard the real signing secret and
        // AdminGuard the real ADMIN_ADDRESS, matching how both are wired in
        // production.
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => process.env[key]) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for a non-admin caller', async () => {
    await request(app.getHttpServer())
      .patch('/admin/credentials/logistics')
      .set('Authorization', bearer(NON_ADMIN_ADDRESS))
      .send({ key: 'does-not-matter' })
      .expect(403);
  });

  it('accepts admin and never leaks credential values in response', async () => {
    // First-time set: no key previously configured.
    expect(logisticsService.getApiKey()).toBeNull();

    const res = await request(app.getHttpServer())
      .patch('/admin/credentials/logistics')
      .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
      .send({ key: 'very-secret-key' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Logistics API key updated and encrypted' });
    // ensure raw credential never echoed back
    expect(JSON.stringify(res.body)).not.toContain('very-secret-key');

    expect(logisticsService.getApiKey()).toBe('very-secret-key');
  });

  it('rotates to the submitted key even when one is already configured, without leaking secrets', async () => {
    // Seed an existing key the same way a real caller would: an earlier
    // rotation, not a mocked internal method.
    await logisticsService.rotateApiKey('old-compromised-key');
    const encryptedBefore = logisticsService.getEncryptedApiKey();

    const res = await request(app.getHttpServer())
      .patch('/admin/credentials/logistics')
      .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
      .send({ key: 'brand-new-key' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Logistics API key updated and encrypted' });
    expect(JSON.stringify(res.body)).not.toContain('old-compromised-key');
    expect(JSON.stringify(res.body)).not.toContain('brand-new-key');

    // The endpoint must actually use the submitted key, not silently keep
    // the old one.
    expect(logisticsService.getApiKey()).toBe('brand-new-key');
    expect(logisticsService.getEncryptedApiKey()).not.toBe(encryptedBefore);
  });
});

describe('ApiKeysController (issue #498)', () => {
  function buildDto(key: string): RotateApiKeyDto {
    const dto = new RotateApiKeyDto();
    dto.key = key;
    return dto;
  }

  it('rotates to the submitted key on first set (no key previously configured)', async () => {
    const logisticsService = new LogisticsService(undefined, encryptionKeyConfig);
    const controller = new ApiKeysController(logisticsService);

    expect(logisticsService.getApiKey()).toBeNull();

    const result = await controller.rotateLogisticsKey(
      buildDto('brand-new-key'),
    );

    expect(logisticsService.getApiKey()).toBe('brand-new-key');
    expect(result).toEqual({
      message: 'Logistics API key updated and encrypted',
    });
  });

  it('rotates to the submitted key when a key already exists, instead of re-encrypting the old one', async () => {
    const logisticsService = new LogisticsService(undefined, encryptionKeyConfig);
    const controller = new ApiKeysController(logisticsService);

    await controller.rotateLogisticsKey(buildDto('compromised-old-key'));
    expect(logisticsService.getApiKey()).toBe('compromised-old-key');
    const encryptedBefore = logisticsService.getEncryptedApiKey();

    await controller.rotateLogisticsKey(buildDto('brand-new-replacement-key'));

    // The endpoint must actually use the submitted key, not silently keep
    // re-encrypting the compromised one.
    expect(logisticsService.getApiKey()).toBe('brand-new-replacement-key');
    expect(logisticsService.getEncryptedApiKey()).not.toBe(encryptedBefore);
  });

  it('does not echo the submitted key (or any part of it) in the response', async () => {
    const logisticsService = new LogisticsService(undefined, encryptionKeyConfig);
    const controller = new ApiKeysController(logisticsService);

    const secretKey = 'super-secret-value-should-not-leak';
    const result = await controller.rotateLogisticsKey(buildDto(secretKey));

    expect(JSON.stringify(result)).not.toContain(secretKey);
  });
});
