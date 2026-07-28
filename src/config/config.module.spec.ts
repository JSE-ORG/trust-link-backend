import { Keypair } from '@stellar/stellar-sdk';
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
 * We bootstrap NestConfigModule with the same Joi schema used in production
 * so that validation behaviour is tested end-to-end.
 */

// Real valid test fixtures — used by .env.test and SEP10 service tests
const VALID_SECRET_KEY =
  'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C';
const VALID_PUBLIC_KEY =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

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
};

/**
 * Helper to bootstrap the app with custom env vars.
 *
 * NestConfigModule.forRoot() validates process.env eagerly in the @Module
 * decorator, so the module must be loaded fresh for each test case.
 * jest.isolateModulesAsync + require() is the only way to achieve this
 * without --experimental-vm-modules.
 */
async function buildConfigService(
  env: Record<string, string>,
): Promise<ConfigService> {
  const originalEnv = { ...process.env };

  Object.keys(process.env).forEach((key) => {
    delete process.env[key];
  });
  Object.assign(process.env, env);

  try {
    let service: ConfigService;
    await jest.isolateModulesAsync(async () => {
      // require() is necessary here — NestConfigModule.forRoot() runs
      // at module load time, so each test needs a fresh module instance.
      // Dynamic import() is not supported without --experimental-vm-modules.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Test } = require('@nestjs/testing');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ConfigModule } = require('./config.module');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ConfigService: Svc } = require('./config.service');

      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule],
      }).compile();

      service = moduleRef.get(Svc);
    });
    return service!;
  } finally {
    Object.keys(process.env).forEach((key) => {
      delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
  }
}

describe('ConfigModule — Stellar Key Validation', () => {
  describe('valid Stellar keys pass validation', () => {
    it('accepts a genuine valid SYSTEM_SIGNER_SECRET', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('SYSTEM_SIGNER_SECRET')).toBe(VALID_SECRET_KEY);
    });

    it('accepts a genuine valid ADMIN_ADDRESS', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('ADMIN_ADDRESS')).toBe(VALID_PUBLIC_KEY);
    });

    it('accepts a genuine valid SEP10_SIGNING_SECRET', async () => {
      const service = await buildConfigService(VALID_ENV);
      expect(service).toBeDefined();
      expect(service.get('SEP10_SIGNING_SECRET')).toBe(ANOTHER_VALID_SECRET);
    });

    it('boots successfully when SEP10_SIGNING_SECRET is omitted (optional)', async () => {
      const envWithout = { ...VALID_ENV };
      delete (envWithout as Record<string, string | undefined>)
        .SEP10_SIGNING_SECRET;
      const service = await buildConfigService(envWithout);
      expect(service).toBeDefined();
    });
  });

  describe('checksum-invalid secret keys are rejected', () => {
    it('rejects a shape-valid but checksum-invalid SYSTEM_SIGNER_SECRET', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        }),
      ).rejects.toThrow();
    });

    it('error message contains the variable name', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        expect((error as Error).message).toContain('SYSTEM_SIGNER_SECRET');
      }
    });

    it('error message contains the word "invalid"', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: CHECKSUM_INVALID_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        expect((error as Error).message).toContain('invalid');
      }
    });

    it('rejects a shape-valid but checksum-invalid SEP10_SIGNING_SECRET', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SEP10_SIGNING_SECRET: CHECKSUM_INVALID_SECRET,
        }),
      ).rejects.toThrow();
    });
  });

  describe('public key supplied where secret key expected', () => {
    it('rejects a public key (G...) as SYSTEM_SIGNER_SECRET', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET,
        }),
      ).rejects.toThrow();
    });

    it('error message mentions the prefix mismatch', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: PUBLIC_KEY_AS_SECRET,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('SYSTEM_SIGNER_SECRET');
        expect(message).toContain('must start with S');
      }
    });
  });

  describe('checksum-invalid public keys are rejected', () => {
    it('rejects a shape-valid but checksum-invalid ADMIN_ADDRESS', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC,
        }),
      ).rejects.toThrow();
    });

    it('error message contains the variable name and "invalid"', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: CHECKSUM_INVALID_PUBLIC,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('ADMIN_ADDRESS');
        expect(message).toContain('invalid');
      }
    });
  });

  describe('secret key supplied where public key expected', () => {
    it('rejects a secret key (S...) as ADMIN_ADDRESS', async () => {
      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: SECRET_KEY_AS_PUBLIC,
        }),
      ).rejects.toThrow();
    });

    it('error message mentions the prefix mismatch for public key', async () => {
      try {
        await buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: SECRET_KEY_AS_PUBLIC,
        });
        fail('Expected validation to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('ADMIN_ADDRESS');
        expect(message).toContain('must start with G');
      }
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
        fail('Expected validation to throw');
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
        fail('Expected validation to throw');
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
      const invalidPrefix =
        'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
      const invalidChar =
        'SOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      await expect(
        buildConfigService({
          ...VALID_ENV,
          SYSTEM_SIGNER_SECRET: invalidChar,
        }),
      ).rejects.toThrow();
    });

    it('rejects public key with invalid Base32 characters', async () => {
      const invalidChar =
        'GOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      await expect(
        buildConfigService({
          ...VALID_ENV,
          ADMIN_ADDRESS: invalidChar,
        }),
      ).rejects.toThrow();
    });

    it('real-world scenario: typo in last char of secret key is caught', async () => {
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
