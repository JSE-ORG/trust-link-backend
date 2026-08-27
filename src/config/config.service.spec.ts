import { Test } from '@nestjs/testing';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import {
  AutoReleaseSourceNotConfiguredError,
  ConfigService,
} from './config.service';

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
  AUTO_RELEASE_SOURCE_ADDRESS: Joi.string()
    .pattern(/^G[A-Z2-7]{55}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'Config validation error: AUTO_RELEASE_SOURCE_ADDRESS must be a valid Stellar public key (starts with G)',
    }),
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

const VALID_AUTO_RELEASE_SOURCE_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const INVALID_AUTO_RELEASE_SOURCE_ADDRESS =
  'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const ALL_KNOWN_KEYS = [
  ...Object.keys(VALID_ENV),
  'PORT',
  'AUTO_RELEASE_SOURCE_ADDRESS',
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

  it('accepts a genuine valid AUTO_RELEASE_SOURCE_ADDRESS', async () => {
    const service = await buildService({
      ...VALID_ENV,
      AUTO_RELEASE_SOURCE_ADDRESS: VALID_AUTO_RELEASE_SOURCE_ADDRESS,
    });
    expect(service.get('AUTO_RELEASE_SOURCE_ADDRESS')).toBe(
      VALID_AUTO_RELEASE_SOURCE_ADDRESS,
    );
  });

  it('rejects an invalid AUTO_RELEASE_SOURCE_ADDRESS', async () => {
    await expect(
      buildService({
        ...VALID_ENV,
        AUTO_RELEASE_SOURCE_ADDRESS: INVALID_AUTO_RELEASE_SOURCE_ADDRESS,
      }),
    ).rejects.toThrow(
      'Config validation error: AUTO_RELEASE_SOURCE_ADDRESS must be a valid Stellar public key (starts with G)',
    );
  });

  describe('requireAutoReleaseSourceAddress (#672)', () => {
    it('returns the address when AUTO_RELEASE_SOURCE_ADDRESS is set', async () => {
      const service = await buildService({
        ...VALID_ENV,
        AUTO_RELEASE_SOURCE_ADDRESS: VALID_AUTO_RELEASE_SOURCE_ADDRESS,
      });
      expect(service.requireAutoReleaseSourceAddress()).toBe(
        VALID_AUTO_RELEASE_SOURCE_ADDRESS,
      );
    });

    it('throws AutoReleaseSourceNotConfiguredError when it is unset', async () => {
      const service = await buildService(VALID_ENV);
      expect(() => service.requireAutoReleaseSourceAddress()).toThrow(
        AutoReleaseSourceNotConfiguredError,
      );
    });
  });
});
