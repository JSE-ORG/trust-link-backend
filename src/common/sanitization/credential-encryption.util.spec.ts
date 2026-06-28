import { encryptCredential, decryptCredential, reencryptCredential } from './credential-encryption.util';

describe('CredentialEncryption', () => {
  const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(() => {
    // Set a valid 64-character hex key for testing
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterEach(() => {
    // Restore original key
    if (originalKey) {
      process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    }
  });

  describe('encryptCredential', () => {
    it('should encrypt a plaintext credential', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':');
    });

    it('should produce different ciphertext for the same plaintext (due to random IV)', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted1 = encryptCredential(plaintext);
      const encrypted2 = encryptCredential(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw when CREDENTIAL_ENCRYPTION_KEY is not set', () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      expect(() => encryptCredential('test')).toThrow(
        'CREDENTIAL_ENCRYPTION_KEY environment variable is required',
      );
    });

    it('should throw when CREDENTIAL_ENCRYPTION_KEY has invalid length', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = 'short-key';

      expect(() => encryptCredential('test')).toThrow(
        'CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters',
      );
    });
  });

  describe('decryptCredential', () => {
    it('should decrypt a credential successfully', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext);
      const decrypted = decryptCredential(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const encrypted = encryptCredential(plaintext);
      const decrypted = decryptCredential(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = 'key-with-special-chars!@#$%^&*()';
      const encrypted = encryptCredential(plaintext);
      const decrypted = decryptCredential(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw when encrypted format is invalid', () => {
      const invalidEncrypted = 'invalid-format';

      expect(() => decryptCredential(invalidEncrypted)).toThrow(
        'Invalid encrypted credential format',
      );
    });

    it('should throw when IV or tag length is malformed', () => {
      // Create a malformed encrypted string with wrong IV length
      const malformedEncrypted = 'short-iv:tag:ciphertext';

      expect(() => decryptCredential(malformedEncrypted)).toThrow(
        'Malformed encrypted credential',
      );
    });

    it('should throw when decryption fails (tampered data)', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext);
      
      // Tamper with the encrypted data
      const parts = encrypted.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -5)}xxxxx`;

      expect(() => decryptCredential(tampered)).toThrow(
        'Failed to decrypt credential',
      );
    });

    it('should throw when CREDENTIAL_ENCRYPTION_KEY is not set', () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      const encrypted = encryptCredential('test');

      expect(() => decryptCredential(encrypted)).toThrow(
        'CREDENTIAL_ENCRYPTION_KEY environment variable is required',
      );
    });
  });

  describe('reencryptCredential', () => {
    it('should re-encrypt a credential with the same key', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted1 = encryptCredential(plaintext);
      const reencrypted = reencryptCredential(encrypted1);
      const decrypted = decryptCredential(reencrypted);

      expect(reencrypted).not.toBe(encrypted1);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext on each re-encryption', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext);
      const reencrypted1 = reencryptCredential(encrypted);
      const reencrypted2 = reencryptCredential(encrypted);

      expect(reencrypted1).not.toBe(reencrypted2);
    });

    it('should throw when encrypted format is invalid', () => {
      const invalidEncrypted = 'invalid-format';

      expect(() => reencryptCredential(invalidEncrypted)).toThrow(
        'Invalid encrypted credential format',
      );
    });
  });

  describe('encryption round-trip', () => {
    it('should successfully encrypt and decrypt multiple times', () => {
      const plaintext = 'my-secret-api-key-12345';
      
      let encrypted = encryptCredential(plaintext);
      let decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);

      // Second round
      encrypted = encryptCredential(decrypted);
      decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);

      // Third round
      encrypted = encryptCredential(decrypted);
      decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });
});
