import { Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { EscrowService } from '../escrow/escrow.service';
import { SorobanPollerService } from './soroban-poller.service';

const PUBLIC_TESTNET_RPC = 'https://soroban-testnet.stellar.org';

interface Mocks {
  blockchainListener: { parseEvent: jest.Mock };
  cursorService: { get: jest.Mock; set: jest.Mock };
  escrowService: { syncStateFromChain: jest.Mock };
}

function makeMocks(): Mocks {
  return {
    blockchainListener: { parseEvent: jest.fn() },
    cursorService: {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    },
    escrowService: {
      syncStateFromChain: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function makeConfig(
  overrides: Record<string, unknown> = {},
  nodeEnv: 'development' | 'production' | 'test' = 'test',
): ConfigService {
  const values: Record<string, unknown> = {
    SOROBAN_RPC_URL: 'https://rpc.example.com/soroban',
    CONTRACT_ID: 'CCONTRACT',
    SOROBAN_POLL_INTERVAL_MS: 5000,
    SOROBAN_RPC_TIMEOUT_MS: 4000,
    STELLAR_NETWORK: 'TESTNET',
    NODE_ENV: nodeEnv,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    isProduction: () => nodeEnv === 'production',
    isDevelopment: () => nodeEnv === 'development',
    isTest: () => nodeEnv === 'test',
  } as unknown as ConfigService;
}

function makeService(
  config: ConfigService,
  mocks: Mocks = makeMocks(),
): { service: SorobanPollerService; mocks: Mocks } {
  const service = new SorobanPollerService(
    config,
    mocks.blockchainListener as unknown as BlockchainListenerService,
    mocks.cursorService as unknown as CursorService,
    mocks.escrowService as unknown as EscrowService,
  );
  return { service, mocks };
}

/** Minimal Response stand-in for mocking global.fetch. */
function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

/**
 * A fetch implementation that never settles on its own and only rejects with
 * an AbortError once the request's signal fires — models a hung RPC endpoint.
 */
function hangingFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(
        Object.assign(new Error('This operation was aborted'), {
          name: 'AbortError',
        }),
      ),
    );
  });
}

describe('SorobanPollerService', () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('RPC URL resolution', () => {
    it('uses the configured SOROBAN_RPC_URL when set', () => {
      const { service } = makeService(
        makeConfig({ SOROBAN_RPC_URL: 'https://rpc.example.com/soroban' }),
      );
      expect(service['rpcUrl']).toBe('https://rpc.example.com/soroban');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('throws in production when SOROBAN_RPC_URL is unset instead of falling back', () => {
      expect(() =>
        makeService(makeConfig({ SOROBAN_RPC_URL: undefined }, 'production')),
      ).toThrow(/SOROBAN_RPC_URL is required in production/);
    });

    it('defaults to the public testnet RPC outside production and logs the default', () => {
      const { service } = makeService(
        makeConfig({ SOROBAN_RPC_URL: undefined }, 'development'),
      );
      expect(service['rpcUrl']).toBe(PUBLIC_TESTNET_RPC);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('defaulting to public testnet RPC'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(PUBLIC_TESTNET_RPC),
      );
    });

    it('never falls back to a third-party mainnet endpoint', () => {
      const { service } = makeService(
        makeConfig({ SOROBAN_RPC_URL: undefined }, 'development'),
      );
      expect(service['rpcUrl']).not.toContain('validationcloud');
    });
  });

  describe('onModuleInit guard', () => {
    it('disables the poller when CONTRACT_ID is unset, naming CONTRACT_ID as the cause', () => {
      const { service } = makeService(makeConfig({ CONTRACT_ID: undefined }));
      service.onModuleInit();
      expect(service['timer']).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('CONTRACT_ID not set'),
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('SOROBAN_RPC_URL'),
      );
    });

    it('starts the poller when CONTRACT_ID is set', () => {
      jest.useFakeTimers();
      const mocks = makeMocks();
      // Keep the immediate first poll inert.
      mocks.cursorService.get.mockRejectedValue(new Error('not under test'));
      const { service } = makeService(makeConfig(), mocks);
      try {
        service.onModuleInit();
        expect(service['timer']).not.toBeNull();
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('starting poll every'),
        );
      } finally {
        service.onModuleDestroy();
        jest.useRealTimers();
      }
    });
  });

  describe('RPC request timeout', () => {
    it('aborts a request that never resolves and does not block the following cycle', async () => {
      jest.useFakeTimers();
      try {
        const mocks = makeMocks();
        mocks.cursorService.get.mockResolvedValue('PAGING_TOKEN');
        const { service } = makeService(makeConfig(), mocks);

        const fetchMock = jest
          .fn()
          .mockImplementationOnce(hangingFetch)
          .mockResolvedValue(
            jsonResponse({ result: { events: [], latestLedger: 100 } }),
          );
        global.fetch = fetchMock as unknown as typeof fetch;

        const firstCycle = service.poll();
        await jest.advanceTimersByTimeAsync(4001);
        await firstCycle;

        // The timeout is logged distinctly (warn, not the generic error path).
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('timed out after 4000ms'),
        );

        // The polling guard was released: the next cycle issues a new request.
        await service.poll();
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('passes an abort signal with every RPC request', async () => {
      const mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue('PAGING_TOKEN');
      const { service } = makeService(makeConfig(), mocks);

      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ result: { events: [], latestLedger: 100 } }),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      await service.poll();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
