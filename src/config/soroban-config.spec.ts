import { configValidationSchema } from './config.module';

/**
 * Validation tests for the Soroban poller configuration:
 *
 * - SOROBAN_RPC_URL must be an explicit URI in production and under
 *   STELLAR_NETWORK=MAINNET, and must agree with the configured network.
 * - SOROBAN_POLL_INTERVAL_MS must be a bounded integer with its default in
 *   the schema, so a bad value fails at startup instead of producing
 *   setInterval(fn, NaN).
 *
 * The exported Joi schema is validated directly so the tests are independent
 * of any local .env file and of process.env.
 */

const BASE_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SEP10_JWT_SECRET: 'test-jwt-secret-32-characters-long!!',
  SYSTEM_SIGNER_SECRET:
    'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C',
  ADMIN_ADDRESS: 'GBEFNNUJ3IRKU2JEAMWBA7YI52HF2GYPHMDXF37T75GHK5KU2Y2QSUAJ',
  CONTRACT_ID: 'test-contract-id',
  NODE_ENV: 'development',
};

// Production additionally requires a webhook secret and a Sentry DSN.
const PRODUCTION_ENV: Record<string, string> = {
  ...BASE_ENV,
  NODE_ENV: 'production',
  STELLAR_WEBHOOK_SECRET: 'test-webhook-hmac-secret',
  SENTRY_DSN: 'https://key@org.ingest.sentry.io/123',
  CONTACT_ENCRYPTION_KEY: 'a'.repeat(64),
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
};

function validate(env: Record<string, string>) {
  return configValidationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
  });
}

describe('Soroban configuration validation', () => {
  describe('SOROBAN_RPC_URL', () => {
    it('fails in production when SOROBAN_RPC_URL is missing', () => {
      const { error } = validate(PRODUCTION_ENV);
      expect(error).toBeDefined();
      expect(error?.message).toContain('SOROBAN_RPC_URL');
      expect(error?.message).toContain('required in production');
    });

    it('passes in production when SOROBAN_RPC_URL is set', () => {
      const { error } = validate({
        ...PRODUCTION_ENV,
        SOROBAN_RPC_URL: 'https://rpc.example.com/soroban',
      });
      expect(error).toBeUndefined();
    });

    it('passes in development when SOROBAN_RPC_URL is missing (testnet default applies)', () => {
      const { error, value } = validate(BASE_ENV);
      expect(error).toBeUndefined();
      expect(value.SOROBAN_RPC_URL).toBeUndefined();
    });

    it('rejects a value that is not a URI', () => {
      const { error } = validate({
        ...BASE_ENV,
        SOROBAN_RPC_URL: 'not-a-url',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('SOROBAN_RPC_URL');
    });

    it('rejects a testnet URL when STELLAR_NETWORK is MAINNET', () => {
      const { error } = validate({
        ...BASE_ENV,
        STELLAR_NETWORK: 'MAINNET',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('testnet');
      expect(error?.message).toContain('MAINNET');
    });

    it('rejects a mainnet URL when STELLAR_NETWORK is TESTNET', () => {
      const { error } = validate({
        ...BASE_ENV,
        STELLAR_NETWORK: 'TESTNET',
        SOROBAN_RPC_URL: 'https://mainnet.example.com/soroban/rpc',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('mainnet');
      expect(error?.message).toContain('TESTNET');
    });

    it('requires SOROBAN_RPC_URL whenever STELLAR_NETWORK is MAINNET, even outside production', () => {
      const { error } = validate({
        ...BASE_ENV,
        STELLAR_NETWORK: 'MAINNET',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('SOROBAN_RPC_URL');
      expect(error?.message).toContain('MAINNET');
    });

    it('accepts a matching testnet URL under STELLAR_NETWORK=TESTNET', () => {
      const { error } = validate({
        ...BASE_ENV,
        STELLAR_NETWORK: 'TESTNET',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('SOROBAN_POLL_INTERVAL_MS', () => {
    it('rejects a non-numeric value with a clear message', () => {
      const { error } = validate({
        ...BASE_ENV,
        SOROBAN_POLL_INTERVAL_MS: 'abc',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('SOROBAN_POLL_INTERVAL_MS');
      expect(error?.message).toContain('integer number of milliseconds');
    });

    it('rejects zero, which would make setInterval fire continuously', () => {
      const { error } = validate({
        ...BASE_ENV,
        SOROBAN_POLL_INTERVAL_MS: '0',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('SOROBAN_POLL_INTERVAL_MS');
      expect(error?.message).toContain('at least 1000ms');
    });

    it('rejects values below the 1000ms minimum', () => {
      const { error } = validate({
        ...BASE_ENV,
        SOROBAN_POLL_INTERVAL_MS: '500',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('at least 1000ms');
    });

    it('rejects non-integer values', () => {
      const { error } = validate({
        ...BASE_ENV,
        SOROBAN_POLL_INTERVAL_MS: '1500.5',
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain('SOROBAN_POLL_INTERVAL_MS');
    });

    it('defaults to 5000 when unset', () => {
      const { error, value } = validate(BASE_ENV);
      expect(error).toBeUndefined();
      expect(value.SOROBAN_POLL_INTERVAL_MS).toBe(5000);
    });

    it('accepts a valid interval and coerces it to a number', () => {
      const { error, value } = validate({
        ...BASE_ENV,
        SOROBAN_POLL_INTERVAL_MS: '10000',
      });
      expect(error).toBeUndefined();
      expect(value.SOROBAN_POLL_INTERVAL_MS).toBe(10000);
    });
  });
});
