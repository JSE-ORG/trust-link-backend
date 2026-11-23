/**
 * Covers the GiglClient factory registered by LogisticsModule (issue #1227):
 * no client without LOGISTICS_API_BASE_URL, and a client whose token is read
 * from GiglLogisticsService at call time when the URL is set.
 */
import { FactoryProvider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ModuleRef } from '@nestjs/core';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';
import { GiglClient, GiglUnauthorizedError } from './gigl/gigl.client';
import { LogisticsModule } from './logistics.module';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type GiglFactory = (
  config: ConfigService,
  moduleRef: ModuleRef,
) => GiglClient | null;

function giglClientFactory(): GiglFactory {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    LogisticsModule,
  ) as unknown[];
  const provider = providers.find(
    (p): p is FactoryProvider =>
      typeof p === 'object' &&
      p !== null &&
      (p as FactoryProvider).provide === GiglClient,
  );
  if (!provider) throw new Error('GiglClient provider not registered');
  return provider.useFactory as GiglFactory;
}

function configWith(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('LogisticsModule GiglClient factory (issue #1227)', () => {
  let get: jest.Mock;

  beforeEach(() => {
    get = jest.fn();
    mockedAxios.create.mockReturnValue({ get } as unknown as AxiosInstance);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when LOGISTICS_API_BASE_URL is not set', () => {
    const moduleRef = { get: jest.fn() } as unknown as ModuleRef;

    const client = giglClientFactory()(configWith({}), moduleRef);

    expect(client).toBeNull();
    expect(mockedAxios.create).not.toHaveBeenCalled();
    expect(moduleRef.get).not.toHaveBeenCalled();
  });

  it('returns null when LOGISTICS_API_BASE_URL is empty', () => {
    const moduleRef = { get: jest.fn() } as unknown as ModuleRef;

    expect(
      giglClientFactory()(
        configWith({ LOGISTICS_API_BASE_URL: '' }),
        moduleRef,
      ),
    ).toBeNull();
  });

  it('builds a client for the base URL and reads the API key at call time', async () => {
    const getApiKey = jest
      .fn()
      .mockReturnValueOnce('key-v1')
      .mockReturnValueOnce('key-v2');
    const moduleRef = {
      get: jest.fn().mockReturnValue({ getApiKey }),
    } as unknown as ModuleRef;
    get.mockResolvedValue({ data: { not: 'a tracking payload' } });

    const client = giglClientFactory()(
      configWith({ LOGISTICS_API_BASE_URL: 'https://api.gigl.test/v1' }),
      moduleRef,
    );

    expect(client).toBeInstanceOf(GiglClient);
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.gigl.test/v1' }),
    );
    // Building the client must not resolve the service yet: the service
    // depends on this client, so it is looked up lazily per request.
    expect(moduleRef.get).not.toHaveBeenCalled();

    await client!.fetchTracking('TRK1').catch(() => undefined);
    await client!.fetchTracking('TRK2').catch(() => undefined);

    expect(moduleRef.get).toHaveBeenCalledWith(GiglLogisticsService, {
      strict: false,
    });
    expect(get.mock.calls.map((call) => call[1].headers.Authorization)).toEqual(
      ['Bearer key-v1', 'Bearer key-v2'],
    );
  });

  it('rejects the request when the service has no API key', async () => {
    const moduleRef = {
      get: jest.fn().mockReturnValue({ getApiKey: () => null }),
    } as unknown as ModuleRef;

    const client = giglClientFactory()(
      configWith({ LOGISTICS_API_BASE_URL: 'https://api.gigl.test/v1' }),
      moduleRef,
    );

    await expect(client!.fetchTracking('TRK1')).rejects.toBeInstanceOf(
      GiglUnauthorizedError,
    );
    expect(get).not.toHaveBeenCalled();
  });
});
