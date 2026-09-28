import 'reflect-metadata';
import axios from 'axios';
import { resolveStellarServerRpcUrl } from './stellar-endpoint-resolver';
import { ConfigService } from '../config/config.service';
import { STELLAR_HORIZON_URLS, STELLAR_RPC_URLS } from './stellar-endpoints';
import { SorobanPollerService } from './soroban-poller.service';
import { HorizonService } from './horizon.service';
import { EventReplayService } from './event-replay.service';
import { buildCspConnectSrc } from '../common/security/csp.config';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
    isProduction: jest.fn(() => values.NODE_ENV === 'production'),
  } as unknown as ConfigService;
}

function makePoller(values: Record<string, unknown>): SorobanPollerService {
  return new SorobanPollerService(
    config({
      SOROBAN_RPC_TIMEOUT_MS: 4000,
      SOROBAN_POLL_INTERVAL_MS: 5000,
      SOROBAN_POLLER_ENABLED: false,
      ...values,
    }),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('Stellar endpoint selection (#871)', () => {
  describe('StellarModule STELLAR_SERVER', () => {
    it.each([
      ['TESTNET', STELLAR_RPC_URLS.TESTNET],
      ['MAINNET', STELLAR_RPC_URLS.MAINNET],
    ] as const)('uses the %s default RPC URL', (network, expected) => {
      expect(
        resolveStellarServerRpcUrl(config({ STELLAR_NETWORK: network })),
      ).toBe(expected);
    });

    it('uses SOROBAN_RPC_URL instead of the network default', () => {
      expect(
        resolveStellarServerRpcUrl(
          config({
            STELLAR_NETWORK: 'TESTNET',
            SOROBAN_RPC_URL: 'https://rpc.override.example',
          }),
        ),
      ).toBe('https://rpc.override.example');
    });
  });

  describe('SorobanPollerService', () => {
    it.each([
      ['TESTNET', STELLAR_RPC_URLS.TESTNET],
      ['MAINNET', STELLAR_RPC_URLS.MAINNET],
    ] as const)('resolves the %s default RPC URL', (network, expected) => {
      const service = makePoller({
        STELLAR_NETWORK: network,
        SOROBAN_RPC_URL: undefined,
      });

      expect((service as unknown as { rpcUrl: string }).rpcUrl).toBe(expected);
    });

    it('uses SOROBAN_RPC_URL instead of the network default', () => {
      const service = makePoller({
        STELLAR_NETWORK: 'MAINNET',
        SOROBAN_RPC_URL: 'https://rpc.override.example',
      });

      expect((service as unknown as { rpcUrl: string }).rpcUrl).toBe(
        'https://rpc.override.example',
      );
    });
  });

  describe('HorizonService', () => {
    it.each([
      ['TESTNET', STELLAR_HORIZON_URLS.TESTNET],
      ['MAINNET', STELLAR_HORIZON_URLS.MAINNET],
    ] as const)('resolves the %s default Horizon URL', (network, expected) => {
      const service = new HorizonService(
        config({ STELLAR_NETWORK: network, STELLAR_HORIZON_URL: undefined }),
      );

      expect(service.getHorizonUrl()).toBe(expected);
    });

    it('uses STELLAR_HORIZON_URL instead of the network default', () => {
      const service = new HorizonService(
        config({
          STELLAR_NETWORK: 'MAINNET',
          STELLAR_HORIZON_URL: 'https://horizon.override.example',
        }),
      );

      expect(service.getHorizonUrl()).toBe('https://horizon.override.example');
    });
  });

  describe('EventReplayService', () => {
    it.each([
      ['TESTNET', STELLAR_HORIZON_URLS.TESTNET],
      ['MAINNET', STELLAR_HORIZON_URLS.MAINNET],
    ] as const)(
      'requests the %s default Horizon URL',
      async (network, expected) => {
        mockedAxios.get.mockResolvedValue({
          data: { _embedded: { records: [] } },
        });
        const service = new EventReplayService(
          config({ STELLAR_NETWORK: network }),
          { processOperationDto: jest.fn() } as never,
          {
            get: jest.fn().mockResolvedValue(undefined),
            set: jest.fn(),
          } as never,
        );

        await service.onModuleInit();

        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.stringContaining(`${expected}/operations`),
          expect.anything(),
        );
      },
    );
  });

  describe('CSP connect-src', () => {
    it.each([
      ['TESTNET', STELLAR_HORIZON_URLS.TESTNET],
      ['MAINNET', STELLAR_HORIZON_URLS.MAINNET],
    ] as const)('allows the %s default Horizon origin', (network, expected) => {
      const [origin] = expected.match(/^https?:\/\/[^/]+/) ?? [];

      expect(buildCspConnectSrc({ stellarNetwork: network })).toContain(origin);
    });

    it('uses STELLAR_HORIZON_URL instead of the network default', () => {
      expect(
        buildCspConnectSrc({
          stellarNetwork: 'MAINNET',
          stellarHorizonUrl: 'https://horizon.override.example/path',
        }),
      ).toContain('https://horizon.override.example');
    });
  });
});
