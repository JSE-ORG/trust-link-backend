import {
  encryptCredential,
  decryptCredential,
  reencryptCredential,
} from './credential-encryption.util';

describe('CredentialEncryption', () => {
  const encryptionKey = 'a'.repeat(64);

  describe('encryptCredential', () => {
    it('should encrypt a plaintext credential', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext, encryptionKey);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':');
    });

    it('should produce different ciphertext for the same plaintext (due to random IV)', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted1 = encryptCredential(plaintext, encryptionKey);
      const encrypted2 = encryptCredential(plaintext, encryptionKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw when encryption key has invalid length', () => {
      expect(() => encryptCredential('test', 'short-key')).toThrow(
        'Encryption key must be exactly 64 hex characters',
      );
    });
  });

  describe('decryptCredential', () => {
    it('should decrypt a credential successfully', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext, encryptionKey);
      const decrypted = decryptCredential(encrypted, encryptionKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const encrypted = encryptCredential(plaintext, encryptionKey);
      const decrypted = decryptCredential(encrypted, encryptionKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = 'key-with-special-chars!@#$%^&*()';
      const encrypted = encryptCredential(plaintext, encryptionKey);
      const decrypted = decryptCredential(encrypted, encryptionKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw when encrypted format is invalid', () => {
      const invalidEncrypted = 'invalid-format';

      expect(() => decryptCredential(invalidEncrypted, encryptionKey)).toThrow(
        'Invalid encrypted credential format',
      );
    });

    it('should throw when IV or tag length is malformed', () => {
      // Create a malformed encrypted string with wrong IV length
      const malformedEncrypted = 'short-iv:tag:ciphertext';

      expect(() =>
        decryptCredential(malformedEncrypted, encryptionKey),
      ).toThrow('Malformed encrypted credential');
    });

    it('should throw when decryption fails (tampered data)', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext, encryptionKey);

      // Tamper with the encrypted data
      const parts = encrypted.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -5)}xxxxx`;

      expect(() => decryptCredential(tampered, encryptionKey)).toThrow(
        'Failed to decrypt credential',
      );
    });
  });

  describe('reencryptCredential', () => {
    it('should re-encrypt a credential with the same key', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted1 = encryptCredential(plaintext, encryptionKey);
      const reencrypted = reencryptCredential(
        encrypted1,
        encryptionKey,
        encryptionKey,
      );
      const decrypted = decryptCredential(reencrypted, encryptionKey);

      expect(reencrypted).not.toBe(encrypted1);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext on each re-encryption', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encryptCredential(plaintext, encryptionKey);
      const reencrypted1 = reencryptCredential(
        encrypted,
        encryptionKey,
        encryptionKey,
      );
      const reencrypted2 = reencryptCredential(
        encrypted,
        encryptionKey,
        encryptionKey,
      );

      expect(reencrypted1).not.toBe(reencrypted2);
    });

    it('should throw when encrypted format is invalid', () => {
      const invalidEncrypted = 'invalid-format';

      expect(() =>
        reencryptCredential(invalidEncrypted, encryptionKey, encryptionKey),
      ).toThrow('Invalid encrypted credential format');
    });
  });

  describe('encryption round-trip', () => {
    it('should successfully encrypt and decrypt multiple times', () => {
      const plaintext = 'my-secret-api-key-12345';

      let encrypted = encryptCredential(plaintext, encryptionKey);
      let decrypted = decryptCredential(encrypted, encryptionKey);
      expect(decrypted).toBe(plaintext);

      // Second round
      encrypted = encryptCredential(decrypted, encryptionKey);
      decrypted = decryptCredential(encrypted, encryptionKey);
      expect(decrypted).toBe(plaintext);

      // Third round
      encrypted = encryptCredential(decrypted, encryptionKey);
      decrypted = decryptCredential(encrypted, encryptionKey);
      expect(decrypted).toBe(plaintext);
    });
  });
});
