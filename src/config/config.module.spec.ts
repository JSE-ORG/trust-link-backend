import { Keypair } from '@stellar/stellar-sdk';
import { configValidationSchema } from './config.schema';
import { Test } from '@nestjs/testing';
import type { ConfigService } from './config.service';

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
 * We call `configValidationSchema.validate(...)` directly against a per-test
 * env object. This shares one definition with `ConfigModule` so that the
 * runtime path and the assertions never drift, and there is no Nest module
 * lifecycle (and no `process.env`) in the test path. Each test is fully
 * independent: the env it supplies is the env that gets validated.
 */

// Real valid test fixtures — used by .env.test and SEP10 service tests.
// VALID_PUBLIC_KEY is the actual derivation of VALID_SECRET_KEY, so
// `Keypair.fromSecret(VALID_SECRET_KEY).publicKey() === VALID_PUBLIC_KEY`.
// Real valid test fixtures — used by .env.test and SEP10 service tests
const VALID_SECRET_KEY =
  'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C';
const VALID_PUBLIC_KEY =
  'GBEFNNUJ3IRKU2JEAMWBA7YI52HF2GYPHMDXF37T75GHK5KU2Y2QSUAJ';

// Another valid secret key for testing SEP10_SIGNING_SECRET separately
const ANOTHER_VALID_SECRET =
  'SDWG7OPXKSKX2JMFVO2C4W37DA56UKOZIUYP34COSENTJ53OIYMYYS4V';

// Shape-valid but checksum-invalid keys (all A's in the checksum part)
const CHECKSUM_INVALID_SECRET =
  'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CHECKSUM_INVALID_PUBLIC =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
};

/**
 * Joint options used for every per-test validate() call — mirrors the
 * options `ConfigModule` passes to NestConfigModule so the assertions
 * observe the same behaviour the runtime does (all errors at once,
 * unknown keys still permitted).
 */
const VALIDATE_OPTIONS = {
  abortEarly: false,
  allowUnknown: true,
} as const;

// Every env key the tests touch — saved/wiped/restored for full isolation.
const ALL_KNOWN_KEYS: string[] = Object.keys(VALID_ENV);

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
  Object.keys(env).forEach((key) => {
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  });

  jest.resetModules();

  // Must be a dynamic require, not a static import: this needs to
  // re-evaluate the module fresh after jest.resetModules() above (to
  // re-run its load-time env validation against the env mutated in this
  // test), and a static import is hoisted/cached so it would never see that.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ConfigModule: LocalConfigModule } = require('./config.module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  const { ConfigService: LocalConfigService } = require('./config.service');

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [LocalConfigModule],
    }).compile();

    return moduleRef.get(LocalConfigService);
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
    it('accepts a genuine valid SYSTEM_SIGNER_SECRET', () => {
      const { error, value } = configValidationSchema.validate(
        { ...VALID_ENV },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeUndefined();
      expect(value.SYSTEM_SIGNER_SECRET).toBe(VALID_SECRET_KEY);
    });

    it('accepts a genuine valid SEP10_SIGNING_SECRET', () => {
      const { error, value } = configValidationSchema.validate(
        { ...VALID_ENV },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeUndefined();
      expect(value.SEP10_SIGNING_SECRET).toBe(ANOTHER_VALID_SECRET);
    });

    it('accepts a genuine valid ADMIN_ADDRESS', () => {
      const { error, value } = configValidationSchema.validate(
        { ...VALID_ENV },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeUndefined();
      expect(value.ADMIN_ADDRESS).toBe(VALID_PUBLIC_KEY);
    });

    it('allows SEP10_SIGNING_SECRET to be optional and fall back to SYSTEM_SIGNER_SECRET', () => {
      // Schema marks SEP10_SIGNING_SECRET as `.optional()`, so `undefined` is
      // equivalent to omitting the key — we exercise the fallback branch.
      const env = { ...VALID_ENV, SEP10_SIGNING_SECRET: undefined };

      const { error, value } = configValidationSchema.validate(
        env,
        VALIDATE_OPTIONS,
      );

      expect(error).toBeUndefined();
      expect(value.SYSTEM_SIGNER_SECRET).toBe(VALID_SECRET_KEY);
    });
  });

  describe('checksum-invalid secret keys are rejected at startup', () => {
    it('rejects SYSTEM_SIGNER_SECRET with invalid checksum', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });

    it('rejects SEP10_SIGNING_SECRET with invalid checksum', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SEP10_SIGNING_SECRET');
    });

    it('error message for SYSTEM_SIGNER_SECRET names the variable', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });

    it('error message for SEP10_SIGNING_SECRET names the variable', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error?.message).toContain('SEP10_SIGNING_SECRET');
    });

    it('error message says "invalid" and does not say "pattern"', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error?.message.toLowerCase()).toContain('invalid');
      expect(error?.message).not.toContain('pattern');
    });

    it('error message mentions checksum verification', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error?.message.toLowerCase()).toContain('checksum');
    });
    it('error message for SYSTEM_SIGNER_SECRET names the variable', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        throw new Error('Expected validation to throw');
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
        throw new Error('Expected validation to throw');
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
        throw new Error('Expected validation to throw');
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
        throw new Error('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message.toLowerCase()).toContain('checksum');
      }
    });
  });

  describe('public key rejected where secret key expected', () => {
    it('rejects public key (G...) as SYSTEM_SIGNER_SECRET', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });

    it('rejects public key (G...) as SEP10_SIGNING_SECRET', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SEP10_SIGNING_SECRET: PUBLIC_KEY_AS_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SEP10_SIGNING_SECRET');
    });

    it('error message explains key must start with S for secret key', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
      expect(error?.message.toLowerCase()).toContain('start');
      expect(error?.message.toLowerCase()).toContain('s');
    });
    it('error message explains key must start with S for secret key', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET,
        });
        throw new Error('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('SYSTEM_SIGNER_SECRET');
        expect(message.toLowerCase()).toContain('start');
        expect(message.toLowerCase()).toContain('s');
      }
    });
  });

  describe('ADMIN_ADDRESS validated as Stellar public key', () => {
    it('rejects a secret key (S...) as ADMIN_ADDRESS', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: SECRET_KEY_AS_PUBLIC },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('ADMIN_ADDRESS');
    });

    it('rejects arbitrary string as ADMIN_ADDRESS', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: RANDOM_STRING },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('ADMIN_ADDRESS');
    });

    it('rejects checksum-invalid public key as ADMIN_ADDRESS', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('ADMIN_ADDRESS');
    });

    it('error message names ADMIN_ADDRESS', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: RANDOM_STRING },
        VALIDATE_OPTIONS,
      );

      expect(error?.message).toContain('ADMIN_ADDRESS');
    });

    it('error message for secret key in ADMIN_ADDRESS explains key must start with G', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: SECRET_KEY_AS_PUBLIC },
        VALIDATE_OPTIONS,
      );

      expect(error?.message).toContain('ADMIN_ADDRESS');
      expect(error?.message.toLowerCase()).toContain('start');
      expect(error?.message.toLowerCase()).toContain('g');
    });
    it('error message names ADMIN_ADDRESS', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: RANDOM_STRING,
        });
        throw new Error('Expected validation to throw');
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
        throw new Error('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('ADMIN_ADDRESS');
        expect(message.toLowerCase()).toContain('start');
        expect(message.toLowerCase()).toContain('g');
      }
    });

    it('rejects empty string as ADMIN_ADDRESS', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: EMPTY_STRING },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('ADMIN_ADDRESS');
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

  describe('completely malformed strings', () => {
    it('rejects a random string as SYSTEM_SIGNER_SECRET', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: RANDOM_STRING,
        }),
      ).rejects.toThrow();
    });

    it('rejects an empty string as SYSTEM_SIGNER_SECRET', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: EMPTY_STRING,
        }),
      ).rejects.toThrow();
    });

    it('rejects a random string as ADMIN_ADDRESS', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: RANDOM_STRING,
        }),
      ).rejects.toThrow();
    });

    it('rejects an empty string as ADMIN_ADDRESS', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: EMPTY_STRING,
        }),
      ).rejects.toThrow();
    });
  });

  describe('error messages do not reference "pattern"', () => {
    it('SYSTEM_SIGNER_SECRET error does not say "pattern"', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        throw new Error('Expected validation to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain('pattern');
      }
    });

    it('ADMIN_ADDRESS error does not say "pattern"', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC,
        });
        throw new Error('Expected validation to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain('pattern');
      }
    });
  });

  describe('Keypair.fromSecret round-trip proves valid key', () => {
    it('valid secret key round-trips through Keypair', () => {
      const keypair = Keypair.fromSecret(VALID_SECRET_KEY);
      expect(keypair.publicKey()).toBe(
        'GBEFNNUJ3IRKU2JEAMWBA7YI52HF2GYPHMDXF37T75GHK5KU2Y2QSUAJ',
      );
    });
  });

  describe('config validation with mixed valid and invalid keys', () => {
    it('fails if only SYSTEM_SIGNER_SECRET is invalid', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
    });

    it('fails if only SEP10_SIGNING_SECRET is invalid', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
    });

    it('fails if only ADMIN_ADDRESS is invalid', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: RANDOM_STRING },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
    });

    it('succeeds when all three Stellar keys are valid', () => {
      const { error, value } = configValidationSchema.validate(
        { ...VALID_ENV },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeUndefined();
      expect(value.SYSTEM_SIGNER_SECRET).toBe(VALID_SECRET_KEY);
      expect(value.SEP10_SIGNING_SECRET).toBe(ANOTHER_VALID_SECRET);
      expect(value.ADMIN_ADDRESS).toBe(VALID_PUBLIC_KEY);
    });
  });

  describe('abortEarly: false shows all validation errors', () => {
    it('reports multiple errors when multiple fields are invalid', () => {
      const { error } = configValidationSchema.validate(
        {
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
          SEP10_SIGNING_SECRET: RANDOM_STRING,
          ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC,
        },
        VALIDATE_OPTIONS,
      );

      // With abortEarly: false, all three field errors should appear in the message.
      const message = error?.message ?? '';
      expect(message).toContain('SYSTEM_SIGNER_SECRET');
      expect(message).toContain('SEP10_SIGNING_SECRET');
      expect(message).toContain('ADMIN_ADDRESS');
    });
  });

  describe('edge cases and regression tests', () => {
    it('rejects Stellar address with wrong prefix (T... or invalid prefix)', async () => {
      // This should fail because it doesn't start with S or G
      const invalidPrefix =
        'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: invalidPrefix },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });

    it('rejects secret key that is too short', () => {
      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: 'SAAAA' },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });

    it('rejects secret key with invalid Base32 characters', () => {
      // Contains 'O' which is not in the valid Base32 set [A-Z2-7]
      const invalidChar =
        'SOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: invalidChar },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });

    it('rejects public key with invalid Base32 characters', () => {
      // Contains 'O' which is not in the valid Base32 set [A-Z2-7]
      const invalidChar =
        'GOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, ADMIN_ADDRESS: invalidChar },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('ADMIN_ADDRESS');
    });

    it('real-world scenario: typo in last char of secret key is caught', () => {
      // Valid key with last character changed to create a checksum error
      const typo = 'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35X';

      const { error } = configValidationSchema.validate(
        { ...VALID_ENV, SYSTEM_SIGNER_SECRET: typo },
        VALIDATE_OPTIONS,
      );

      expect(error).toBeDefined();
      expect(error?.message).toContain('SYSTEM_SIGNER_SECRET');
    });
  });
});
