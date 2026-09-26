/**
 * Unit tests for LogisticsService — missing encryption-key branch coverage.
 *
 * Issue #731: Three call sites guard against a missing CREDENTIAL_ENCRYPTION_KEY.
 * This suite verifies each one rejects/throws without persisting plaintext credentials,
 * plus the fourth branch: the `if (key)` guard in loadPersistedApiKey().
 *
 * No real DB or HTTP calls are made — PrismaService and ConfigService are mocked.
 */

import { LogisticsService } from './logistics.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

// A valid 64-hex-char (32-byte) AES-256 encryption key for tests that need one.
const VALID_KEY = 'a'.repeat(64);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(
  overrides: Partial<Record<string, string | undefined>> = {},
): jest.Mocked<Pick<ConfigService, 'get'>> {
  const store: Record<string, string | undefined> = {
    CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
    LOGISTICS_API_KEY: undefined,
    ...overrides,
  };
  return {
    get: jest.fn(<T>(key: string) => store[key] as T),
  };
}

type MockPrisma = Pick<PrismaService, 'providerCredential'> & {
  providerCredential: { upsert: jest.Mock; findUnique: jest.Mock };
};

function makePrisma(): MockPrisma {
  // The real delegate carries dozens of members the service never touches, so
  // the literal is widened rather than stubbed out in full.
  return {
    providerCredential: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as unknown as MockPrisma;
}

function makeService(
  config: jest.Mocked<Pick<ConfigService, 'get'>>,
  prisma?: ReturnType<typeof makePrisma>,
): LogisticsService {
  return new LogisticsService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('LogisticsService — missing encryption-key branches (issue #731)', () => {
  // ── Branch 1: setApiKey() when CREDENTIAL_ENCRYPTION_KEY is absent ────────

  describe('setApiKey() with no CREDENTIAL_ENCRYPTION_KEY', () => {
    it('throws an error instead of storing a plaintext credential', () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const prisma = makePrisma();
      const service = makeService(config, prisma);

      expect(() => service.setApiKey('my-secret-key')).toThrow(
        'CREDENTIAL_ENCRYPTION_KEY is not configured',
      );
    });

    it('does not update the in-memory apiKey when the encryption key is absent', () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const service = makeService(config);

      try {
        service.setApiKey('my-secret-key');
      } catch {
        // expected
      }

      // getEncryptedApiKey() returns null — nothing was stored.
      expect(service.getEncryptedApiKey()).toBeNull();
    });
  });

  // ── Branch 2: rotateApiKey() when CREDENTIAL_ENCRYPTION_KEY is absent ────

  describe('rotateApiKey() with no CREDENTIAL_ENCRYPTION_KEY', () => {
    it('rejects with an error instead of persisting a plaintext credential', async () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const prisma = makePrisma();
      const service = makeService(config, prisma);

      await expect(service.rotateApiKey('my-secret-key')).rejects.toThrow(
        'CREDENTIAL_ENCRYPTION_KEY is not configured',
      );
    });

    it('never calls prisma.providerCredential.upsert when the encryption key is absent', async () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const prisma = makePrisma();
      const service = makeService(config, prisma);

      await service.rotateApiKey('my-secret-key').catch(() => undefined);

      expect(prisma.providerCredential.upsert).not.toHaveBeenCalled();
    });

    it('does not update the in-memory apiKey when the encryption key is absent', async () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const service = makeService(config);

      await service.rotateApiKey('my-secret-key').catch(() => undefined);

      expect(service.getEncryptedApiKey()).toBeNull();
    });
  });

  // ── Branch 3: getApiKey() when CREDENTIAL_ENCRYPTION_KEY is absent ───────

  describe('getApiKey() with no CREDENTIAL_ENCRYPTION_KEY', () => {
    it('throws when an encrypted key is stored but the encryption key is now absent', () => {
      // First configure with a valid key to store an encrypted value.
      const configWithKey = makeConfig();
      const service = makeService(configWithKey);
      service.setApiKey('my-secret-key');

      // Now simulate the encryption key disappearing from config.
      const configWithoutKey = makeConfig({
        CREDENTIAL_ENCRYPTION_KEY: undefined,
      });
      // Re-wire the private configService reference by constructing a fresh
      // service with the encrypted value already set.
      const serviceNoKey = makeService(configWithoutKey);
      serviceNoKey.setEncryptedApiKey(service.getEncryptedApiKey()!);

      expect(() => serviceNoKey.getApiKey()).toThrow(
        'Failed to decrypt logistics API key',
      );
    });

    it('does not return plaintext when the encryption key is absent', () => {
      const configWithKey = makeConfig();
      const service = makeService(configWithKey);
      service.setApiKey('my-secret-key');
      const encrypted = service.getEncryptedApiKey()!;

      const serviceNoKey = makeService(
        makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined }),
      );
      serviceNoKey.setEncryptedApiKey(encrypted);

      let result: string | null = null;
      try {
        result = serviceNoKey.getApiKey();
      } catch {
        // expected — must not succeed
      }

      expect(result).toBeNull();
    });
  });

  // ── Branch 4: loadPersistedApiKey() `if (key)` guard ─────────────────────
  // When LOGISTICS_API_KEY is present but CREDENTIAL_ENCRYPTION_KEY is absent,
  // the env token must NOT be encrypted and stored — apiKey stays null.

  describe('loadPersistedApiKey() — if (key) guard', () => {
    it('does not store the env token in plaintext when CREDENTIAL_ENCRYPTION_KEY is absent', async () => {
      const config = makeConfig({
        LOGISTICS_API_KEY: 'raw-token-from-env',
        CREDENTIAL_ENCRYPTION_KEY: undefined,
      });
      const prisma = makePrisma(); // findUnique returns null → no persisted key
      const service = makeService(config, prisma);

      await service.onModuleInit();

      // apiKey must remain null — the env token was not stored without encryption.
      expect(service.getEncryptedApiKey()).toBeNull();
    });

    it('stores the encrypted env token when CREDENTIAL_ENCRYPTION_KEY IS present', async () => {
      const config = makeConfig({
        LOGISTICS_API_KEY: 'raw-token-from-env',
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
      });
      const prisma = makePrisma();
      const service = makeService(config, prisma);

      await service.onModuleInit();

      // apiKey should be set to an encrypted value (non-null).
      expect(service.getEncryptedApiKey()).not.toBeNull();
    });
  });
});
