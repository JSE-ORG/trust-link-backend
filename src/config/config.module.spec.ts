import { Test } from '@nestjs/testing';

import { Keypair } from '@stellar/stellar-sdk';
import { ConfigModule } from './config.module';
import { ConfigService } from './config.service';

/**
 * ConfigModule validation tests — Stellar key checksum validation.
 *
 * These tests assert that:
 * 1. Valid keys pass validation
 * 2. Shape-valid but checksum-invalid keys are rejected at startup
 * 3. Public keys supplied where secret keys expected are rejected
 * 4. ADMIN_ADDRESS rejects secret keys and malformed strings
 * 5. Error messages name the variable and say "invalid"
 *
 * We bootstrap NestConfigModule with the same Joi schema used in production
 * so that validation behaviour is tested end-to-end.
 */

// Real valid test fixtures — used by .env.test and SEP10 service tests
const VALID_SECRET_KEY = 'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C';
const VALID_PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// Another valid secret key for testing SEP10_SIGNING_SECRET separately
const ANOTHER_VALID_SECRET = 'SDWG7OPXKSKX2JMFVO2C4W37DA56UKOZIUYP34COSENTJ53OIYMYYS4V';

// Shape-valid but checksum-invalid keys (all A's in the checksum part)
const CHECKSUM_INVALID_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CHECKSUM_INVALID_PUBLIC = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// Public key supplied where secret key expected
const PUBLIC_KEY_AS_SECRET = VALID_PUBLIC_KEY;

// Secret key supplied where public key expected
const SECRET_KEY_AS_PUBLIC = VALID_SECRET_KEY;

// Completely malformed strings
const RANDOM_STRING = 'not-a-stellar-key-at-all';
const EMPTY_STRING = '';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SEP10_JWT_SECRET: 'test-jwt-secret-32-characters-long!!',
  SYSTEM_SIGNER_SECRET: VALID_SECRET_KEY,
  SEP10_SIGNING_SECRET: ANOTHER_VALID_SECRET,
  ADMIN_ADDRESS: VALID_PUBLIC_KEY,
  CONTRACT_ID: 'test-contract-id',
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
  'AUTO_RELEASE_SOURCE_ADDRESS',
  'OTEL_ENABLED',
  'OTEL_SERVICE_NAME',
  'OTEL_SERVICE_VERSION',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'GIT_SHA',
  'REDIS_URL',
  'DB_POOL_CONNECTION_LIMIT',
  'DB_POOL_TIMEOUT_MS',
];

/**
 * Helper to bootstrap the app with custom env vars.
 * Isolates each test by saving/restoring process.env.
 */
async function buildConfigService(
  env: Record<string, string | undefined>,
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
      imports: [ConfigModule],
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

describe('ConfigModule — Stellar Key Validation', () => {
  describe('valid Stellar keys pass validation', () => {
    it('accepts a genuine valid SYSTEM_SIGNER_SECRET', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('SYSTEM_SIGNER_SECRET')).toBe(VALID_SECRET_KEY);
    });

    it('accepts a genuine valid SEP10_SIGNING_SECRET', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('SEP10_SIGNING_SECRET')).toBe(ANOTHER_VALID_SECRET);
    });

    it('accepts a genuine valid ADMIN_ADDRESS', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('ADMIN_ADDRESS')).toBe(VALID_PUBLIC_KEY);
    });

    it('allows SEP10_SIGNING_SECRET to be optional and fall back to SYSTEM_SIGNER_SECRET', async () => {
      const envWithoutSep10 = {
        ...VALID_ENV,
        SEP10_SIGNING_SECRET: undefined,
      };
      delete envWithoutSep10.SEP10_SIGNING_SECRET;

      const service = await buildConfigService(envWithoutSep10);
      expect(service).toBeDefined();
      // SEP10_SIGNING_SECRET is optional, so it may not be set
      expect(service.get('SYSTEM_SIGNER_SECRET')).toBe(VALID_SECRET_KEY);
    });
  });

  describe('checksum-invalid secret keys are rejected at startup', () => {
    it('rejects SYSTEM_SIGNER_SECRET with invalid checksum', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('rejects SEP10_SIGNING_SECRET with invalid checksum', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('error message for SYSTEM_SIGNER_SECRET names the variable', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('SYSTEM_SIGNER_SECRET');
      }
    });

    it('error message for SEP10_SIGNING_SECRET names the variable', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('SEP10_SIGNING_SECRET');
      }
    });

    it('error message says "invalid" and does not say "pattern"', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message.toLowerCase()).toContain('invalid');
        expect(message).not.toContain('pattern');
      }
    });

    it('error message mentions checksum verification', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message.toLowerCase()).toContain('checksum');
      }
    });
  });

  describe('public key rejected where secret key expected', () => {
    it('rejects public key (G...) as SYSTEM_SIGNER_SECRET', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('rejects public key (G...) as SEP10_SIGNING_SECRET', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        SEP10_SIGNING_SECRET: PUBLIC_KEY_AS_SECRET,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('error message explains key must start with S for secret key', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('SYSTEM_SIGNER_SECRET');
        expect(message.toLowerCase()).toContain('start');
        expect(message.toLowerCase()).toContain('s');
      }
    });
  });

  describe('ADMIN_ADDRESS validated as Stellar public key', () => {
    it('rejects a secret key (S...) as ADMIN_ADDRESS', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        ADMIN_ADDRESS: SECRET_KEY_AS_PUBLIC,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('rejects arbitrary string as ADMIN_ADDRESS', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        ADMIN_ADDRESS: RANDOM_STRING,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('rejects checksum-invalid public key as ADMIN_ADDRESS', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });

    it('error message names ADMIN_ADDRESS', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: RANDOM_STRING,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('ADMIN_ADDRESS');
      }
    });

    it('error message for secret key in ADMIN_ADDRESS explains key must start with G', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: SECRET_KEY_AS_PUBLIC,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('ADMIN_ADDRESS');
        expect(message.toLowerCase()).toContain('start');
        expect(message.toLowerCase()).toContain('g');
      }
    });

    it('rejects empty string as ADMIN_ADDRESS', async () => {
      const invalidEnv = {
        ...VALID_ENV,
        ADMIN_ADDRESS: EMPTY_STRING,
      };

      await expect(buildConfigService(invalidEnv)).rejects.toThrow();
    });
  });

  describe('Stellar SDK Keypair behavior — unit tests', () => {
    it('Keypair.fromSecret throws on checksum-invalid secret key', () => {
      expect(() => Keypair.fromSecret(CHECKSUM_INVALID_SECRET)).toThrow();
    });

    it('Keypair.fromSecret succeeds on valid secret key', () => {
      expect(() => Keypair.fromSecret(VALID_SECRET_KEY)).not.toThrow();
    });

    it('Keypair.fromPublicKey throws on checksum-invalid public key', () => {
      expect(() => Keypair.fromPublicKey(CHECKSUM_INVALID_PUBLIC)).toThrow();
    });

    it('Keypair.fromPublicKey succeeds on valid public key', () => {
      expect(() => Keypair.fromPublicKey(VALID_PUBLIC_KEY)).not.toThrow();
    });

    it('Keypair.fromSecret rejects public key (G...)', () => {
      expect(() => Keypair.fromSecret(VALID_PUBLIC_KEY)).toThrow();
    });

    it('Keypair.fromPublicKey rejects secret key (S...)', () => {
      expect(() => Keypair.fromPublicKey(VALID_SECRET_KEY)).toThrow();
    });

    it('Keypair.fromSecret throws on random string', () => {
      expect(() => Keypair.fromSecret(RANDOM_STRING)).toThrow();
    });

    it('Keypair.fromPublicKey throws on random string', () => {
      expect(() => Keypair.fromPublicKey(RANDOM_STRING)).toThrow();
    });

    it('derived public key matches expected value for known secret', () => {
      const keypair = Keypair.fromSecret(VALID_SECRET_KEY);
      expect(keypair.publicKey()).toBe(VALID_PUBLIC_KEY);
    });
  });

  describe('config validation with mixed valid and invalid keys', () => {
    it('fails if only SYSTEM_SIGNER_SECRET is invalid', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        }),
      ).rejects.toThrow();
    });

    it('fails if only SEP10_SIGNING_SECRET is invalid', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET,
        }),
      ).rejects.toThrow();
    });

    it('fails if only ADMIN_ADDRESS is invalid', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: RANDOM_STRING,
        }),
      ).rejects.toThrow();
    });

    it('succeeds when all three Stellar keys are valid', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('SYSTEM_SIGNER_SECRET')).toBe(VALID_SECRET_KEY);
      expect(service.get('SEP10_SIGNING_SECRET')).toBe(ANOTHER_VALID_SECRET);
      expect(service.get('ADMIN_ADDRESS')).toBe(VALID_PUBLIC_KEY);
    });
  });

  describe('abortEarly: false shows all validation errors', () => {
    it('reports multiple errors when multiple fields are invalid', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
          SEP10_SIGNING_SECRET: RANDOM_STRING,
          ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        // With abortEarly: false, should include all field names
        expect(message).toContain('SYSTEM_SIGNER_SECRET');
        expect(message).toContain('SEP10_SIGNING_SECRET');
        expect(message).toContain('ADMIN_ADDRESS');
      }
    });
  });

  describe('edge cases and regression tests', () => {
    it('rejects Stellar address with wrong prefix (T... or invalid prefix)', async () => {
      // This should fail because it doesn't start with S or G
      const invalidPrefix = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      // This will fail at the shape check level
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: invalidPrefix,
        }),
      ).rejects.toThrow();
    });

    it('rejects secret key that is too short', async () => {
      const tooShort = 'SAAAA';

      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: tooShort,
        }),
      ).rejects.toThrow();
    });

    it('rejects secret key with invalid Base32 characters', async () => {
      // Contains 'O' which is not in the valid Base32 set [A-Z2-7]
      const invalidChar = 'SOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: invalidChar,
        }),
      ).rejects.toThrow();
    });

    it('rejects public key with invalid Base32 characters', async () => {
      // Contains 'O' which is not in the valid Base32 set [A-Z2-7]
      const invalidChar = 'GOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: invalidChar,
        }),
      ).rejects.toThrow();
    });

    it('real-world scenario: typo in last char of secret key is caught', async () => {
      // Valid key with last character changed to create a checksum error
      const typo = 'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35X';

      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: typo,
        }),
      ).rejects.toThrow();
    });
  });
});
