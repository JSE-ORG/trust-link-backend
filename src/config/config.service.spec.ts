import { Test } from '@nestjs/testing';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { ConfigService } from './config.service';

/**
 * ConfigService unit tests.
 *
 * We bootstrap a minimal NestConfigModule with the same Joi schema used in
 * production so that validation behaviour is tested end-to-end.
 */

const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  SEP10_JWT_SECRET: Joi.string().min(32).required(),
  ADMIN_ADDRESS: Joi.string().required(),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  SENDGRID_API_KEY: Joi.string().optional(),
  TWILIO_ACCOUNT_SID: Joi.string().optional(),
  TWILIO_AUTH_TOKEN: Joi.string().optional(),
  STELLAR_NETWORK: Joi.string().valid('TESTNET', 'MAINNET').default('TESTNET'),
  ALLOWED_ORIGINS: Joi.string().optional(),
  STELLAR_WEBHOOK_SECRET: Joi.string().optional(),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),
  SENTRY_DSN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().uri().optional(),
  }),
});

const VALID_ENV = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SEP10_JWT_SECRET: 'a-very-long-secret-key-for-testing-purposes-32chars',
  ADMIN_ADDRESS: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  NODE_ENV: 'test',
  STELLAR_NETWORK: 'TESTNET',
};

const ALL_KNOWN_KEYS = [
  ...Object.keys(VALID_ENV),
  'PORT',
  'ALLOWED_ORIGINS',
  'STELLAR_WEBHOOK_SECRET',
  'LOG_LEVEL',
  'SENDGRID_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'SENTRY_DSN',
];

async function buildService(
  env: Record<string, string>,
): Promise<ConfigService> {
  // Save and wipe all known keys so tests are fully isolated
  const saved: Record<string, string | undefined> = {};
  ALL_KNOWN_KEYS.forEach((k) => {
    saved[k] = process.env[k];
    delete process.env[k];
  });

  // Apply only the keys for this test
  Object.assign(process.env, env);

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema,
        }),
      ],
      providers: [ConfigService],
    }).compile();

    return moduleRef.get(ConfigService);
  } finally {
    // Restore original env
    ALL_KNOWN_KEYS.forEach((k) => {
      delete process.env[k];
      if (saved[k] !== undefined) process.env[k] = saved[k];
    });
  }
}

describe('ConfigService', () => {
  it('resolves with valid environment variables', async () => {
    const service = await buildService(VALID_ENV);
    expect(service).toBeDefined();
  });

  it('returns correct typed values', async () => {
    const service = await buildService({ ...VALID_ENV, PORT: '4000' });
    expect(service.get('PORT')).toBe(4000);
    expect(service.get('NODE_ENV')).toBe('test');
    expect(service.get('STELLAR_NETWORK')).toBe('TESTNET');
  });

  it('applies default PORT when not set', async () => {
    const env = { ...VALID_ENV };
    const service = await buildService(env);
    // PORT defaults to 3000 when not provided
    expect(service.get('PORT')).toBe(3000);
  });

  it('getAllowedOrigins parses comma-separated origins', async () => {
    const service = await buildService({
      ...VALID_ENV,
      ALLOWED_ORIGINS:
        'https://app.trust-link.io,https://staging.trust-link.io',
    });
    expect(service.getAllowedOrigins()).toEqual([
      'https://app.trust-link.io',
      'https://staging.trust-link.io',
    ]);
  });

  it('getAllowedOrigins returns empty array when not set', async () => {
    const service = await buildService(VALID_ENV);
    expect(service.getAllowedOrigins()).toEqual([]);
  });

  it('isDevelopment / isProduction / isTest helpers work correctly', async () => {
    const service = await buildService({ ...VALID_ENV, NODE_ENV: 'test' });
    expect(service.isTest()).toBe(true);
    expect(service.isDevelopment()).toBe(false);
    expect(service.isProduction()).toBe(false);
  });

  describe('SENTRY_DSN validation', () => {
    it('allows empty/unset SENTRY_DSN in non-production environments', async () => {
      const service = await buildService({
        ...VALID_ENV,
        NODE_ENV: 'development',
      });
      expect(service).toBeDefined();
      expect(service.get('SENTRY_DSN')).toBeUndefined();
    });

    it('allows valid SENTRY_DSN in non-production environments', async () => {
      const service = await buildService({
        ...VALID_ENV,
        NODE_ENV: 'development',
        SENTRY_DSN: 'https://key@sentry.io/123456',
      });
      expect(service).toBeDefined();
      expect(service.get('SENTRY_DSN')).toBe('https://key@sentry.io/123456');
    });

    it('requires valid SENTRY_DSN URI in production environment', async () => {
      const service = await buildService({
        ...VALID_ENV,
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://key@sentry.io/123456',
      });
      expect(service).toBeDefined();
      expect(service.get('SENTRY_DSN')).toBe('https://key@sentry.io/123456');
    });

    it('fails validation if SENTRY_DSN is invalid URI in development environment', async () => {
      await expect(
        buildService({
          ...VALID_ENV,
          NODE_ENV: 'development',
          SENTRY_DSN: 'invalid-uri',
        }),
      ).rejects.toThrow();
    });

    it('fails validation if SENTRY_DSN is unset in production environment', async () => {
      await expect(
        buildService({
          ...VALID_ENV,
          NODE_ENV: 'production',
        }),
      ).rejects.toThrow();
    });
  });
});
