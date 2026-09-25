import { Logger } from '@nestjs/common';

import { encryptCredential } from '../common/sanitization/credential-encryption.util';
import type { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';

import {
  LOGISTICS_CREDENTIAL_PROVIDER,
  LogisticsService,
} from './logistics.service';

/** AES-256-GCM wants exactly 32 bytes, i.e. 64 hex characters. */
const ENCRYPTION_KEY = 'a'.repeat(64);

/**
 * Minimal stand-ins. The service only ever calls `configService.get(key)` and
 * `prisma.providerCredential.findUnique/upsert`, and both constructor
 * parameters are `@Optional()`, so the service can be built directly — which is
 * exactly the case its own doc comments describe for unit tests.
 */
function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

type PrismaStub = {
  providerCredential: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

function prismaWith(record: { encryptedKey: string } | null): PrismaStub {
  return {
    providerCredential: {
      findUnique: jest.fn().mockResolvedValue(record),
      upsert: jest.fn().mockResolvedValue(record ?? {}),
    },
  };
}

function asPrisma(stub: PrismaStub): PrismaService {
  return stub as unknown as PrismaService;
}

function loggerOf(service: LogisticsService): { warn: jest.Mock } {
  return (service as unknown as { logger: { warn: jest.Mock } }).logger;
}

describe('LogisticsService credential handling', () => {
  describe('setApiKey', () => {
    it('refuses to store a key when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
      const service = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: undefined }),
      );
      service.setEncryptedApiKey('previous-ciphertext');

      expect(() => service.setApiKey('gigl-token')).toThrow(
        'CREDENTIAL_ENCRYPTION_KEY is not configured',
      );
      // The guard has to fail closed: the previously stored key is untouched,
      // and the plaintext never reaches the field.
      expect(service.getEncryptedApiKey()).toBe('previous-ciphertext');
      expect(service.getEncryptedApiKey()).not.toContain('gigl-token');
    });

    it('stores the encrypted key when the encryption key is configured', () => {
      const service = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY }),
      );

      service.setApiKey('gigl-token');

      const stored = service.getEncryptedApiKey();
      expect(stored).not.toBeNull();
      expect(stored).not.toBe('gigl-token');
      // iv:authTag:ciphertext, all hex
      expect(stored).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(service.getApiKey()).toBe('gigl-token');
    });
  });

  describe('rotateApiKey', () => {
    it('rejects when CREDENTIAL_ENCRYPTION_KEY is missing', async () => {
      const prisma = prismaWith(null);
      const service = new LogisticsService(
        asPrisma(prisma),
        configWith({ CREDENTIAL_ENCRYPTION_KEY: undefined }),
      );

      await expect(service.rotateApiKey('rotated-token')).rejects.toThrow(
        'CREDENTIAL_ENCRYPTION_KEY is not configured',
      );
      expect(service.getEncryptedApiKey()).toBeNull();
      expect(prisma.providerCredential.upsert).not.toHaveBeenCalled();
    });

    it('persists the rotated key under the logistics provider row', async () => {
      const prisma = prismaWith(null);
      const service = new LogisticsService(
        asPrisma(prisma),
        configWith({ CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY }),
      );

      await service.rotateApiKey('rotated-token');

      expect(prisma.providerCredential.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.providerCredential.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ provider: LOGISTICS_CREDENTIAL_PROVIDER });
      expect(call.update.encryptedKey).toBe(service.getEncryptedApiKey());
      expect(call.create.provider).toBe(LOGISTICS_CREDENTIAL_PROVIDER);
      expect(service.getApiKey()).toBe('rotated-token');
    });

    it('still rotates in memory when no database is available', async () => {
      const service = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY }),
      );

      await expect(
        service.rotateApiKey('memory-only'),
      ).resolves.toBeUndefined();
      expect(service.getApiKey()).toBe('memory-only');
    });
  });

  describe('getApiKey', () => {
    it('returns null when no key was ever stored', () => {
      const service = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY }),
      );

      expect(service.getApiKey()).toBeNull();
    });

    it('reports a decryption failure (not a missing config) when the key is gone', () => {
      const service = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY }),
      );
      service.setEncryptedApiKey(
        encryptCredential('gigl-token', ENCRYPTION_KEY),
      );

      const withoutKey = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: undefined }),
      );
      withoutKey.setEncryptedApiKey(service.getEncryptedApiKey()!);

      // The `!encryptionKey` guard sits inside the try block, so its message is
      // replaced by the catch. Pinned here so a later refactor that changes the
      // visible behaviour has to change this test too.
      expect(() => withoutKey.getApiKey()).toThrow(
        'Failed to decrypt logistics API key',
      );
    });

    it('reports a decryption failure for a tampered ciphertext', () => {
      const service = new LogisticsService(
        undefined,
        configWith({ CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY }),
      );
      service.setEncryptedApiKey('deadbeef:deadbeef:deadbeef');

      expect(() => service.getApiKey()).toThrow(
        'Failed to decrypt logistics API key',
      );
    });
  });

  describe('onModuleInit credential loading', () => {
    it('loads an already-encrypted key from the database', async () => {
      const encrypted = encryptCredential('persisted-token', ENCRYPTION_KEY);
      const prisma = prismaWith({ encryptedKey: encrypted });
      const service = new LogisticsService(
        asPrisma(prisma),
        configWith({
          CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
          LOGISTICS_API_KEY: 'env-token',
        }),
      );

      await service.onModuleInit();

      expect(service.getEncryptedApiKey()).toBe(encrypted);
      // The stored value wins over the environment fallback.
      expect(service.getApiKey()).toBe('persisted-token');
    });

    it('falls back to LOGISTICS_API_KEY, encrypted, on a first boot', async () => {
      const prisma = prismaWith(null);
      const service = new LogisticsService(
        asPrisma(prisma),
        configWith({
          CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
          LOGISTICS_API_KEY: 'env-token',
        }),
      );

      await service.onModuleInit();

      expect(service.getApiKey()).toBe('env-token');
      expect(service.getEncryptedApiKey()).not.toBe('env-token');
    });

    it('silently drops the environment token when no encryption key is configured', async () => {
      const prisma = prismaWith(null);
      const service = new LogisticsService(
        asPrisma(prisma),
        configWith({
          CREDENTIAL_ENCRYPTION_KEY: undefined,
          LOGISTICS_API_KEY: 'env-token',
        }),
      );
      const warn = jest.spyOn(loggerOf(service) as unknown as Logger, 'warn');

      await service.onModuleInit();

      // The env token is never stored in the clear, so the service starts
      // unconfigured — and says so, rather than pretending to have a key.
      expect(service.getEncryptedApiKey()).toBeNull();
      expect(service.getApiKey()).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Logistics provider is not configured'),
      );
    });

    it('warns instead of throwing when the credential lookup fails', async () => {
      const prisma = prismaWith(null);
      prisma.providerCredential.findUnique.mockRejectedValue(
        new Error('database unreachable'),
      );
      const service = new LogisticsService(
        asPrisma(prisma),
        configWith({
          CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
          LOGISTICS_API_KEY: 'env-token',
        }),
      );
      const warn = jest.spyOn(loggerOf(service) as unknown as Logger, 'warn');

      await service.onModuleInit();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load persisted logistics API key'),
      );
      // Fallback path still runs after the failure.
      expect(service.getApiKey()).toBe('env-token');
    });
  });
});
