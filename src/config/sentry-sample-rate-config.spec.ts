import { Test } from '@nestjs/testing';
import type { ConfigService } from './config.service';
import { configValidationSchema } from './config.schema';

/**
 * #1175 — Sentry trace sample-rate configuration.
 *
 * The schema is validated directly for the range checks, and booted through
 * the real ConfigModule for the "invalid value fails boot" guarantee. Each
 * test supplies its own env so nothing leaks from the ambient process env.
 */
const VALID_SECRET_KEY =
  'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C';
const VALID_PUBLIC_KEY =
  'GBEFNNUJ3IRKU2JEAMWBA7YI52HF2GYPHMDXF37T75GHK5KU2Y2QSUAJ';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SEP10_JWT_SECRET: 'test-jwt-secret-32-characters-long!!',
  PRESIGN_SECRET: 'test-presign-secret-64hexcharacters-for-hmac',
  SYSTEM_SIGNER_SECRET: VALID_SECRET_KEY,
  ADMIN_ADDRESS: VALID_PUBLIC_KEY,
  CONTRACT_ID: 'test-contract-id',
  NODE_ENV: 'test',
  STELLAR_NETWORK: 'TESTNET',
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
};

const VALIDATE_OPTIONS = { abortEarly: false, allowUnknown: true } as const;
const MANAGED_KEYS = [...Object.keys(BASE_ENV), 'SENTRY_TRACES_SAMPLE_RATE'];

async function bootWith(env: Record<string, string>): Promise<ConfigService> {
  const saved = new Map<string, string | undefined>();
  MANAGED_KEYS.forEach((key) => {
    saved.set(key, process.env[key]);
    delete process.env[key];
  });
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });
  jest.resetModules();

  try {
    // Dynamic requires are intentional: ConfigModule validates process.env at
    // import time, so it must be loaded fresh after the env is set above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConfigModule } = require('./config.module');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConfigService: LocalConfigService } = require('./config.service');
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
    }).compile();
    return moduleRef.get(LocalConfigService);
  } finally {
    MANAGED_KEYS.forEach((key) => {
      delete process.env[key];
      const original = saved.get(key);
      if (original !== undefined) process.env[key] = original;
    });
  }
}

describe('SENTRY_TRACES_SAMPLE_RATE config validation (#1175)', () => {
  describe('schema validation', () => {
    it('accepts values between 0 and 1 inclusive', () => {
      for (const rate of ['0', '0.05', '0.2', '0.5', '1']) {
        const { error, value } = configValidationSchema.validate(
          { ...BASE_ENV, SENTRY_TRACES_SAMPLE_RATE: rate },
          VALIDATE_OPTIONS,
        );
        expect(error).toBeUndefined();
        expect(value.SENTRY_TRACES_SAMPLE_RATE).toBe(Number(rate));
      }
    });

    it('is optional — omitting it keeps the environment-specific defaults', () => {
      const { error, value } = configValidationSchema.validate(
        { ...BASE_ENV },
        VALIDATE_OPTIONS,
      );
      expect(error).toBeUndefined();
      expect(value.SENTRY_TRACES_SAMPLE_RATE).toBeUndefined();
    });

    it.each([
      ['-0.1', 'at least 0'],
      ['1.5', 'not exceed 1'],
      ['not-a-number', 'between 0 and 1'],
      ['', 'between 0 and 1'],
    ])('rejects the invalid value %p', (rate, message) => {
      const { error } = configValidationSchema.validate(
        { ...BASE_ENV, SENTRY_TRACES_SAMPLE_RATE: rate },
        VALIDATE_OPTIONS,
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('SENTRY_TRACES_SAMPLE_RATE');
      expect(error?.message).toContain(message);
    });
  });

  describe('boot behaviour', () => {
    it('exposes a valid override through ConfigService', async () => {
      const service = await bootWith({
        ...BASE_ENV,
        SENTRY_TRACES_SAMPLE_RATE: '0.05',
      });
      expect(service.get('SENTRY_TRACES_SAMPLE_RATE')).toBe(0.05);
    });

    it('boots without the variable set', async () => {
      const service = await bootWith({ ...BASE_ENV });
      expect(service.get('SENTRY_TRACES_SAMPLE_RATE')).toBeUndefined();
    });

    it('fails boot when the override is out of range', async () => {
      await expect(
        bootWith({ ...BASE_ENV, SENTRY_TRACES_SAMPLE_RATE: '1.5' }),
      ).rejects.toThrow('SENTRY_TRACES_SAMPLE_RATE must not exceed 1');
    });

    it('fails boot when the override is not a number', async () => {
      await expect(
        bootWith({ ...BASE_ENV, SENTRY_TRACES_SAMPLE_RATE: 'high' }),
      ).rejects.toThrow('SENTRY_TRACES_SAMPLE_RATE must be a number');
    });
  });
});
