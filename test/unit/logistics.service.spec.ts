import axios from 'axios';
import { Test } from '@nestjs/testing';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { LogisticsModule } from '../../src/logistics/logistics.module';
import { ConfigService } from '../../src/config/config.service';
import { GiglLogisticsService } from '../../src/logistics/gigl/gigl-logistics.service';
import {
  GiglClient,
  GiglNetworkError,
  GiglProviderError,
} from '../../src/logistics/gigl/gigl.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// jest.mock('axios') mocks the entire module, including axios.isAxiosError.
// The auto-mock returns undefined for isAxiosError, which would cause the
// GiglClient error handling (which relies on isAxiosError) to never trigger
// and just re-throw the original Error. We patch it to match the real check.
beforeAll(() => {
  mockedAxios.isAxiosError.mockImplementation(
    (err: any): err is import('axios').AxiosError =>
      typeof err === 'object' && err !== null && err.isAxiosError === true,
  );
});

describe('LogisticsService & LogisticsModule (issue #479)', () => {
  let service: LogisticsService;
  let mockAxiosInstance: { get: jest.Mock };

  beforeEach(() => {
    mockAxiosInstance = { get: jest.fn() };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
  });

  describe('Runtime API key management', () => {
    beforeEach(() => {
      service = new LogisticsService();
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
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      await service.onModuleInit();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Logistics provider is not configured'),
      );
    });
  });

  describe('Rotation and persistence (issues #498, #499)', () => {
    /** Minimal in-memory stand-in for the ProviderCredential Prisma model. */
    function createFakePrisma() {
      const store = new Map<
        string,
        { provider: string; encryptedKey: string }
      >();
      return {
        providerCredential: {
          findUnique: jest.fn(
            async ({ where: { provider } }: any) => store.get(provider) ?? null,
          ),
          upsert: jest.fn(
            async ({ where: { provider }, update, create }: any) => {
              const existing = store.get(provider);
              const record = existing
                ? { ...existing, ...update }
                : { provider, ...create };
              store.set(provider, record);
              return record;
            },
          ),
        },
        __store: store,
      };
    }

    it('rotates to the submitted key on first set (nothing previously stored)', async () => {
      const prisma = createFakePrisma();
      const svc = new LogisticsService(prisma as any);

      expect(svc.getApiKey()).toBeNull();
      await svc.rotateApiKey('first-key');

      expect(svc.getApiKey()).toBe('first-key');
      expect(prisma.providerCredential.upsert).toHaveBeenCalled();
    });

    it('rotates to the submitted key when a key already exists, and the stored value actually changes', async () => {
      const prisma = createFakePrisma();
      const svc = new LogisticsService(prisma as any);

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
      const prisma = createFakePrisma();
      const svc1 = new LogisticsService(prisma as any);
      await svc1.rotateApiKey('rotated-secret');

      const svc2 = new LogisticsService(prisma as any);
      await svc2.onModuleInit();

      expect(svc2.getApiKey()).toBe('rotated-secret');
    });

    it('falls back to the GIGL_API_TOKEN environment variable when nothing is persisted', async () => {
      const prisma = createFakePrisma();
      const originalToken = process.env.GIGL_API_TOKEN;
      process.env.GIGL_API_TOKEN = 'env-fallback-token';

      try {
        const svc = new LogisticsService(prisma as any);
        await svc.onModuleInit();
        expect(svc.getApiKey()).toBe('env-fallback-token');
      } finally {
        if (originalToken === undefined) {
          delete process.env.GIGL_API_TOKEN;
        } else {
          process.env.GIGL_API_TOKEN = originalToken;
        }
      }
    });

    it('prefers the persisted key over the environment variable', async () => {
      const prisma = createFakePrisma();
      const originalToken = process.env.GIGL_API_TOKEN;
      process.env.GIGL_API_TOKEN = 'env-fallback-token';

      try {
        const svc1 = new LogisticsService(prisma as any);
        await svc1.rotateApiKey('rotated-secret');

        const svc2 = new LogisticsService(prisma as any);
        await svc2.onModuleInit();

        expect(svc2.getApiKey()).toBe('rotated-secret');
      } finally {
        if (originalToken === undefined) {
          delete process.env.GIGL_API_TOKEN;
        } else {
          process.env.GIGL_API_TOKEN = originalToken;
        }
      }
    });
  });

  describe('Provider lookups via LogisticsModule (configured vs unconfigured)', () => {
    it('provides GiglLogisticsService and GiglClient when configured', async () => {
      const mockConfigService = {
        get: (key: string) => {
          if (key === 'GIGL_API_BASE_URL') return 'https://api.gigl.com/v1';
          if (key === 'GIGL_API_TOKEN') return 'test-token-123';
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
      const timeoutError = new Error('request timed out') as any;
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
      const notFoundError = new Error('Not found') as any;
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
        .spyOn((logisticsService as any).logger, 'warn')
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
