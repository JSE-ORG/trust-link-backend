/**
 * Unit tests for LogisticsService, LogisticsModule, and the Gigl provider.
 *
 * Consolidated from `src/logistics/logistics.service.spec.ts` and
 * `test/unit/logistics.service.spec.ts` (issue #853). The former covered the
 * missing-encryption-key branches; the latter covered runtime key management,
 * rotation and persistence, and the Gigl tracking/error-mapping paths. Both are
 * preserved below, so `logistics.service.ts` has exactly one spec next to its
 * source and no coverage was dropped.
 *
 * No real DB or HTTP calls are made — PrismaService, ConfigService and axios
 * are mocked. See the module-level `jest.mock('axios')` for why the real axios
 * module is spread through rather than auto-mocked.
 */

import axios from 'axios';
import { Test } from '@nestjs/testing';
import { LogisticsService } from './logistics.service';
import { LogisticsModule } from './logistics.module';
import { ConfigService } from '../config/config.service';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';
import {
  GiglClient,
  GiglNetworkError,
  GiglUnauthorizedError,
  GiglProviderError,
} from './gigl/gigl.client';
import { ProviderCredentialRepository } from './provider-credential.repository';

// Issue #552: a bare `jest.mock('axios')` auto-mocks the entire module,
// which replaces `axios.isAxiosError` with a `jest.fn()` that returns
// `undefined`. GiglClient.fetchTracking's whole error-mapping branch is
// gated on `axios.isAxiosError(err)`, so with the auto-mock that branch is
// never taken and every fixture error re-throws as a bare Error regardless
// of what `isAxiosError`/`response`/`code` was set on it. Spreading the
// real module through keeps `isAxiosError` (and everything else) genuine
// while still letting `axios.create` be mocked per-test.
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  // `create` is mocked at both the top level and under `default` — with
  // esModuleInterop, `import axios from 'axios'` may resolve to either
  // depending on how ts-jest/babel interop picks it up here, and both must
  // be the *same* jest.fn() so `mockedAxios.create.mockReturnValue(...)` in
  // beforeEach reliably controls whichever one `axios` actually is.
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    ...actual,
    create: mockCreate,
    default: { ...actual, create: mockCreate },
  };
});
const mockedAxios = axios as jest.Mocked<typeof axios>;

const encryptionKeyConfig = {
  get: (key: string) => {
    if (key === 'CREDENTIAL_ENCRYPTION_KEY') return 'a'.repeat(64);
    if (key === 'LOGISTICS_API_KEY') return process.env.LOGISTICS_API_KEY;
    return undefined;
  },
} as ConfigService;

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

function makeRepository(): ProviderCredentialRepository {
  const repository = new ProviderCredentialRepository();
  jest.spyOn(repository, 'findByProvider').mockResolvedValue(null);
  jest.spyOn(repository, 'upsert').mockResolvedValue(undefined);
  return repository;
}

function makeService(
  config: jest.Mocked<Pick<ConfigService, 'get'>>,
  repository?: ReturnType<typeof makeRepository>,
): LogisticsService {
  return new LogisticsService(repository, config as unknown as ConfigService);
}

// ── Suites ───────────────────────────────────────────────────────────────────

describe('LogisticsService — missing encryption-key branches (issue #731)', () => {
  // ── Branch 1: setApiKey() when CREDENTIAL_ENCRYPTION_KEY is absent ────────

  describe('setApiKey() with no CREDENTIAL_ENCRYPTION_KEY', () => {
    it('throws an error instead of storing a plaintext credential', () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const repository = makeRepository();
      const service = makeService(config, repository);

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
      const repository = makeRepository();
      const service = makeService(config, repository);

      await expect(service.rotateApiKey('my-secret-key')).rejects.toThrow(
        'CREDENTIAL_ENCRYPTION_KEY is not configured',
      );
    });

    it('never persists a credential when the encryption key is absent', async () => {
      const config = makeConfig({ CREDENTIAL_ENCRYPTION_KEY: undefined });
      const repository = makeRepository();
      const service = makeService(config, repository);

      await service.rotateApiKey('my-secret-key').catch(() => undefined);

      expect(repository.upsert).not.toHaveBeenCalled();
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
      const repository = makeRepository(); // no persisted key
      const service = makeService(config, repository);

      await service.onModuleInit();

      // apiKey must remain null — the env token was not stored without encryption.
      expect(service.getEncryptedApiKey()).toBeNull();
    });

    it('stores the encrypted env token when CREDENTIAL_ENCRYPTION_KEY IS present', async () => {
      const config = makeConfig({
        LOGISTICS_API_KEY: 'raw-token-from-env',
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
      });
      const repository = makeRepository();
      const service = makeService(config, repository);

      await service.onModuleInit();

      // apiKey should be set to an encrypted value (non-null).
      expect(service.getEncryptedApiKey()).not.toBeNull();
    });
  });
});

describe('LogisticsService & LogisticsModule (issue #479)', () => {
  let service: LogisticsService;
  let mockAxiosInstance: { get: jest.Mock };

  beforeEach(() => {
    mockAxiosInstance = { get: jest.fn() };
    mockedAxios.create.mockReturnValue(
      mockAxiosInstance as unknown as ReturnType<typeof axios.create>,
    );
  });

  describe('Runtime API key management', () => {
    beforeEach(() => {
      service = new LogisticsService(undefined, encryptionKeyConfig);
    });

    it('stores and returns the API key at runtime', () => {
      expect(service.getApiKey()).toBeNull();
      service.setApiKey('secret-key');
      expect(service.getApiKey()).toBe('secret-key');
      expect(service.getEncryptedApiKey()).toBeDefined();

      service.setEncryptedApiKey(service.getEncryptedApiKey()!);
      expect(service.getApiKey()).toBe('secret-key');
    });

    it('rejects requests when the logistics service is not configured', async () => {
      await expect(service.getStatus('US-FEDEX-0001')).rejects.toThrow(
        'Logistics service is not configured',
      );
    });

    it('logs warning at startup when unconfigured', async () => {
      const loggerSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation();
      await service.onModuleInit();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Logistics provider is not configured'),
      );
    });
  });

  describe('Rotation and persistence (issues #498, #499)', () => {
    /** Minimal in-memory stand-in for the provider credential repository. */
    function createFakeRepository() {
      const store = new Map<
        string,
        { provider: string; encryptedKey: string }
      >();
      return {
        findByProvider: jest.fn(
          async (provider: string) => store.get(provider) ?? null,
        ),
        upsert: jest.fn(async (provider: string, encryptedKey: string) => {
          const existing = store.get(provider);
          const record = existing
            ? { ...existing, encryptedKey }
            : { provider, encryptedKey };
          store.set(provider, record);
        }),
        __store: store,
      };
    }

    it('rotates to the submitted key on first set (nothing previously stored)', async () => {
      const repository = createFakeRepository();
      const svc = new LogisticsService(
        repository as unknown as ProviderCredentialRepository,
        encryptionKeyConfig,
      );

      expect(svc.getApiKey()).toBeNull();
      await svc.rotateApiKey('first-key');

      expect(svc.getApiKey()).toBe('first-key');
      expect(repository.upsert).toHaveBeenCalled();
    });

    it('rotates to the submitted key when a key already exists, and the stored value actually changes', async () => {
      const repository = createFakeRepository();
      const svc = new LogisticsService(
        repository as unknown as ProviderCredentialRepository,
        encryptionKeyConfig,
      );

      await svc.rotateApiKey('old-key');
      const encryptedAfterFirst = svc.getEncryptedApiKey();
      expect(svc.getApiKey()).toBe('old-key');

      await svc.rotateApiKey('new-key');
      const encryptedAfterSecond = svc.getEncryptedApiKey();

      // The rotated key must actually be used, not the old one re-encrypted.
      expect(svc.getApiKey()).toBe('new-key');
      expect(encryptedAfterSecond).not.toBe(encryptedAfterFirst);
    });

    it('persists the rotated key so a freshly constructed service instance loads it (issue #499)', async () => {
      const repository = createFakeRepository();
      const svc1 = new LogisticsService(
        repository as unknown as ProviderCredentialRepository,
        encryptionKeyConfig,
      );
      await svc1.rotateApiKey('rotated-secret');

      const svc2 = new LogisticsService(
        repository as unknown as ProviderCredentialRepository,
        encryptionKeyConfig,
      );
      await svc2.onModuleInit();

      expect(svc2.getApiKey()).toBe('rotated-secret');
    });

    it('falls back to the LOGISTICS_API_KEY environment variable when nothing is persisted', async () => {
      const repository = createFakeRepository();
      const originalToken = process.env.LOGISTICS_API_KEY;
      process.env.LOGISTICS_API_KEY = 'env-fallback-token';

      try {
        const svc = new LogisticsService(
          repository as unknown as ProviderCredentialRepository,
          encryptionKeyConfig,
        );
        await svc.onModuleInit();
        expect(svc.getApiKey()).toBe('env-fallback-token');
      } finally {
        if (originalToken === undefined) {
          delete process.env.LOGISTICS_API_KEY;
        } else {
          process.env.LOGISTICS_API_KEY = originalToken;
        }
      }
    });

    it('prefers the persisted key over the environment variable', async () => {
      const repository = createFakeRepository();
      const originalToken = process.env.LOGISTICS_API_KEY;
      process.env.LOGISTICS_API_KEY = 'env-fallback-token';

      try {
        const svc1 = new LogisticsService(
          repository as unknown as ProviderCredentialRepository,
          encryptionKeyConfig,
        );
        await svc1.rotateApiKey('rotated-secret');

        const svc2 = new LogisticsService(
          repository as unknown as ProviderCredentialRepository,
          encryptionKeyConfig,
        );
        await svc2.onModuleInit();

        expect(svc2.getApiKey()).toBe('rotated-secret');
      } finally {
        if (originalToken === undefined) {
          delete process.env.LOGISTICS_API_KEY;
        } else {
          process.env.LOGISTICS_API_KEY = originalToken;
        }
      }
    });
  });

  describe('Provider lookups via LogisticsModule (configured vs unconfigured)', () => {
    it('provides GiglLogisticsService and GiglClient when configured', async () => {
      const mockConfigService = {
        get: (key: string) => {
          if (key === 'LOGISTICS_API_BASE_URL')
            return 'https://api.gigl.com/v1';
          if (key === 'LOGISTICS_API_KEY') return 'test-token-123';
          return undefined;
        },
      };

      const moduleRef = await Test.createTestingModule({
        imports: [LogisticsModule],
      })
        .overrideProvider(ConfigService)
        .useValue(mockConfigService)
        .compile();

      const logisticsService = moduleRef.get(LogisticsService);
      const giglClient = moduleRef.get(GiglClient);
      const giglService = moduleRef.get(GiglLogisticsService);

      expect(logisticsService).toBeInstanceOf(GiglLogisticsService);
      expect(giglService).toBeInstanceOf(GiglLogisticsService);
      expect(giglClient).toBeInstanceOf(GiglClient);
    });

    it('performs successful tracking lookup with complete details including events', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          tracking_number: 'TRK-001',
          current_status: 'DELIVERED',
          carrier_code: 'GIGL-EXPRESS',
          estimated_delivery: '2024-04-01T18:00:00Z',
          events: [
            {
              event_time: '2024-03-30T08:00:00Z',
              event_code: 'PICKUP',
              location: 'Lagos Hub',
              description: 'Parcel picked up.',
            },
          ],
        },
      });

      const giglClient = new GiglClient({
        baseUrl: 'https://api.gigl.com/v1',
        apiToken: 'test-token',
      });
      const giglService = new GiglLogisticsService(giglClient);

      const result = await giglService.getStatus('TRK-001');

      expect(result).toEqual({
        status: 'DELIVERED',
        carrier: 'GIGL-EXPRESS',
        estimatedDelivery: new Date('2024-04-01T18:00:00Z'),
        events: [
          {
            timestamp: new Date('2024-03-30T08:00:00Z'),
            status: 'PICKUP',
            location: 'Lagos Hub',
            description: 'Parcel picked up.',
          },
        ],
      });
    });

    it('handles provider timeout (network error)', async () => {
      const timeoutError = Object.assign(new Error('request timed out'), {
        isAxiosError: true,
        code: 'ECONNABORTED',
      });
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ECONNABORTED';

      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      const giglClient = new GiglClient({
        baseUrl: 'https://api.gigl.com/v1',
        apiToken: 'test-token',
      });
      const giglService = new GiglLogisticsService(giglClient);

      await expect(giglService.getStatus('TRK-TIMEOUT')).rejects.toThrow(
        GiglNetworkError,
      );
    });

    it('handles 404 response (provider error)', async () => {
      const notFoundError = Object.assign(new Error('Not found'), {
        isAxiosError: true,
        response: { status: 404 },
      });
      notFoundError.isAxiosError = true;
      notFoundError.response = { status: 404 };

      mockAxiosInstance.get.mockRejectedValue(notFoundError);

      const giglClient = new GiglClient({
        baseUrl: 'https://api.gigl.com/v1',
        apiToken: 'test-token',
      });
      const giglService = new GiglLogisticsService(giglClient);

      await expect(giglService.getStatus('TRK-404')).rejects.toThrow(
        GiglProviderError,
      );
      await expect(giglService.getStatus('TRK-404')).rejects.toThrow(
        /HTTP 404/,
      );
    });

    it('handles 401 response (unauthorized)', async () => {
      const unauthorizedError = Object.assign(new Error('Unauthorized'), {
        isAxiosError: true,
        response: { status: 401 },
      });
      unauthorizedError.isAxiosError = true;
      unauthorizedError.response = { status: 401 };

      mockAxiosInstance.get.mockRejectedValue(unauthorizedError);

      const giglClient = new GiglClient({
        baseUrl: 'https://api.gigl.com/v1',
        apiToken: 'test-token',
      });
      const giglService = new GiglLogisticsService(giglClient);

      await expect(giglService.getStatus('TRK-401')).rejects.toThrow(
        GiglUnauthorizedError,
      );
    });

    it('propagates a non-Axios error unchanged', async () => {
      const plainError = new Error('something else broke entirely');

      mockAxiosInstance.get.mockRejectedValue(plainError);

      const giglClient = new GiglClient({
        baseUrl: 'https://api.gigl.com/v1',
        apiToken: 'test-token',
      });
      const giglService = new GiglLogisticsService(giglClient);

      // Issue #552 acceptance criteria: must be the *same* error, not
      // wrapped/reclassified as one of the Gigl* error types.
      await expect(giglService.getStatus('TRK-OTHER')).rejects.toBe(plainError);
    });

    it('fails clearly and logs warning at startup when unconfigured', async () => {
      const mockConfigService = {
        get: () => undefined,
      };

      const moduleRef = await Test.createTestingModule({
        imports: [LogisticsModule],
      })
        .overrideProvider(ConfigService)
        .useValue(mockConfigService)
        .compile();

      const logisticsService = moduleRef.get(LogisticsService);

      const loggerSpy = jest
        .spyOn(logisticsService['logger'], 'warn')
        .mockImplementation();

      await logisticsService.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Logistics provider is not configured'),
      );

      await expect(logisticsService.getStatus('TRK-UNCONFIG')).rejects.toThrow(
        'Logistics service is not configured',
      );
    });
  });
});
