import { configValidationSchema } from './config.schema';

const VALID_KEY_64 =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const INVALID_KEY_63 =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde';
const NON_HEX_KEY =
  'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG';

const BASE_PROD_ENV = {
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SYSTEM_SIGNER_SECRET:
    'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C',
  ADMIN_ADDRESS: 'GBEFNNUJ3IRKU2JEAMWBA7YI52HF2GYPHMDXF37T75GHK5KU2Y2QSUAJ',
  SEP10_JWT_SECRET: '12345678901234567890123456789012',
  PRESIGN_SECRET: 'test-presign-secret-64hexcharacters-for-hmac',
  CONTRACT_ID: 'CB6453...VALID',
  NODE_ENV: 'production',
  STELLAR_WEBHOOK_SECRET: 'secret',
  SENTRY_DSN: 'https://key@sentry.io/123',
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  CONTACT_ENCRYPTION_KEY: VALID_KEY_64,
  CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_64,
};

describe('Encryption Keys Config Validation (#564)', () => {
  describe('production requirements', () => {
    it('fails startup in production when CONTACT_ENCRYPTION_KEY is missing', () => {
      const env = { ...BASE_PROD_ENV };
      delete (env as Record<string, string>).CONTACT_ENCRYPTION_KEY;
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toContain('CONTACT_ENCRYPTION_KEY');
    });

    it('fails startup in production when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
      const env = { ...BASE_PROD_ENV };
      delete (env as Record<string, string>).CREDENTIAL_ENCRYPTION_KEY;
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toContain('CREDENTIAL_ENCRYPTION_KEY');
    });
  });

  describe('length and hex format constraints', () => {
    it('rejects a 63-character CONTACT_ENCRYPTION_KEY', () => {
      const env = { ...BASE_PROD_ENV, CONTACT_ENCRYPTION_KEY: INVALID_KEY_63 };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toContain('CONTACT_ENCRYPTION_KEY');
    });

    it('rejects a 63-character CREDENTIAL_ENCRYPTION_KEY', () => {
      const env = {
        ...BASE_PROD_ENV,
        CREDENTIAL_ENCRYPTION_KEY: INVALID_KEY_63,
      };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toContain('CREDENTIAL_ENCRYPTION_KEY');
    });

    it('rejects a non-hex CONTACT_ENCRYPTION_KEY', () => {
      const env = { ...BASE_PROD_ENV, CONTACT_ENCRYPTION_KEY: NON_HEX_KEY };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toContain('CONTACT_ENCRYPTION_KEY');
    });

    it('rejects a non-hex CREDENTIAL_ENCRYPTION_KEY', () => {
      const env = { ...BASE_PROD_ENV, CREDENTIAL_ENCRYPTION_KEY: NON_HEX_KEY };
      const { error } = configValidationSchema.validate(env);
      expect(error).toBeDefined();
      expect(error?.message).toContain('CREDENTIAL_ENCRYPTION_KEY');
    });

    it('accepts valid 64-character hex keys in production', () => {
      const { error } = configValidationSchema.validate(BASE_PROD_ENV);
      expect(error).toBeUndefined();
    });
  });
});
