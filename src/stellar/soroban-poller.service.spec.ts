import { Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { EscrowService } from '../escrow/escrow.service';
import { DlqService } from '../dlq/dlq.service';
import { SorobanPollerService } from './soroban-poller.service';

const PUBLIC_TESTNET_RPC = 'https://soroban-testnet.stellar.org';

interface Mocks {
  blockchainListener: { parseEvent: jest.Mock };
  cursorService: { get: jest.Mock; set: jest.Mock };
  escrowService: {
    syncStateFromChain: jest.Mock;
    findIdByContractEscrowId: jest.Mock;
  };
  dlqService: { enqueue: jest.Mock };
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
      findIdByContractEscrowId: jest.fn().mockResolvedValue('escrow-1'),
    },
    dlqService: {
      enqueue: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function rawEvent(id: string, pagingToken: string) {
  return {
    id,
    contractId: 'CONTRACT',
    type: 'contract',
    ledger: 100,
    pagingToken,
    topic: ['Escrow', 'Funded'],
    value: 'AAAA',
  };
}

function parsedEventFor(contractEscrowId: bigint | number | string) {
  return {
    contractId: 'CONTRACT',
    type: 'contract',
    ledger: 100,
    name: 'Funded',
    topics: ['Escrow', 'Funded'],
    data: { escrow_id: contractEscrowId },
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
    mocks.dlqService as unknown as DlqService,
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

/** Parse the JSON-RPC body of the nth fetch call. */
function bodyOfCall(
  fetchMock: jest.Mock,
  index: number,
): { method: string; params: Record<string, unknown> } {
  const init = fetchMock.mock.calls[index][1] as RequestInit;
  return JSON.parse(init.body as string) as {
    method: string;
    params: Record<string, unknown>;
  };
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
        global.fetch = fetchMock;

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
      global.fetch = fetchMock;

      await service.poll();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('cursor resolution and request body', () => {
    it('with no stored cursor, starts just behind the latest ledger and persists that choice immediately', async () => {
      const mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue(undefined);
      const { service } = makeService(makeConfig(), mocks);

      const fetchMock = jest
        .fn()
        // First call: getLatestLedger.
        .mockResolvedValueOnce(jsonResponse({ result: { sequence: 1000 } }))
        // Second call: getEvents.
        .mockResolvedValueOnce(
          jsonResponse({ result: { events: [], latestLedger: 1000 } }),
        );
      global.fetch = fetchMock;

      await service.poll();

      expect(bodyOfCall(fetchMock, 0).method).toBe('getLatestLedger');

      const events = bodyOfCall(fetchMock, 1);
      expect(events.method).toBe('getEvents');
      expect(events.params.startLedger).toBe(990);
      expect(events.params.startLedger).not.toBe(1);
      expect(events.params).not.toHaveProperty('cursor');

      // Persisted before a restart could skip forward to a new "now".
      expect(mocks.cursorService.set).toHaveBeenCalledWith('ledger:990');
    });

    it('logs and stops when the latest-ledger response has no numeric sequence', async () => {
      const mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue(undefined);
      const { service } = makeService(makeConfig(), mocks);
      const fetchMock = jest
        .fn()
        .mockResolvedValue(jsonResponse({ result: { sequence: '1000' } }));
      global.fetch = fetchMock;

      await service.poll();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bodyOfCall(fetchMock, 0).method).toBe('getLatestLedger');
      expect(mocks.cursorService.set).not.toHaveBeenCalled();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'SorobanPollerService: poll cycle failed',
        expect.any(String),
      );
    });

    it('with a stored paging-token cursor, resumes via the cursor parameter', async () => {
      const mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue('PAGING_TOKEN');
      const { service } = makeService(makeConfig(), mocks);

      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ result: { events: [], latestLedger: 1000 } }),
        );
      global.fetch = fetchMock;

      await service.poll();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const events = bodyOfCall(fetchMock, 0);
      expect(events.method).toBe('getEvents');
      expect(events.params.cursor).toBe('PAGING_TOKEN');
      expect(events.params).not.toHaveProperty('startLedger');
    });

    it('with a persisted ledger cursor, resumes via startLedger', async () => {
      const mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue('ledger:500');
      const { service } = makeService(makeConfig(), mocks);

      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ result: { events: [], latestLedger: 1000 } }),
        );
      global.fetch = fetchMock;

      await service.poll();

      const events = bodyOfCall(fetchMock, 0);
      expect(events.params.startLedger).toBe(500);
      expect(events.params).not.toHaveProperty('cursor');
    });

    it('honours SOROBAN_START_LEDGER as an operator replay point without asking for the latest ledger', async () => {
      const mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue(undefined);
      const { service } = makeService(
        makeConfig({ SOROBAN_START_LEDGER: 12345 }),
        mocks,
      );

      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ result: { events: [], latestLedger: 99999 } }),
        );
      global.fetch = fetchMock;

      await service.poll();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const events = bodyOfCall(fetchMock, 0);
      expect(events.method).toBe('getEvents');
      expect(events.params.startLedger).toBe(12345);
      expect(mocks.cursorService.set).toHaveBeenCalledWith('ledger:12345');
    });
  });

  describe('RPC error classification', () => {
    it('flags a retention-window error distinctly', async () => {
      const { service } = makeService(makeConfig());
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          error: {
            message: 'startLedger must be within the ledger range: 100 - 200',
          },
        }),
      );

      await expect(service['fetchEvents']('ledger:1')).rejects.toThrow(
        /retention window/,
      );
    });

    it('reports other RPC errors without the retention label', async () => {
      const { service } = makeService(makeConfig());
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: 'internal server error' } }),
        );

      await expect(service['fetchEvents']('PAGING_TOKEN')).rejects.toThrow(
        /^Soroban RPC error: internal server error$/,
      );
    });
  });

  describe('cursor advancement and dead-lettering on poll (issue #554)', () => {
    let mocks: Mocks;
    let service: SorobanPollerService;

    function mockRpcResponse(events: ReturnType<typeof rawEvent>[]) {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          result: { events, latestLedger: 200, sequence: 200 },
        }),
      );
    }

    beforeEach(() => {
      mocks = makeMocks();
      mocks.cursorService.get.mockResolvedValue('ledger:900');
      mocks.escrowService.syncStateFromChain.mockResolvedValue({
        skipped: false,
      });
      ({ service } = makeService(makeConfig(), mocks));
    });

    it('advances the cursor to the last event when all events succeed', async () => {
      const events = [
        rawEvent('evt-1', 'token-1'),
        rawEvent('evt-2', 'token-2'),
        rawEvent('evt-3', 'token-3'),
      ];
      mockRpcResponse(events);
      mocks.blockchainListener.parseEvent
        .mockReturnValueOnce(parsedEventFor(1n))
        .mockReturnValueOnce(parsedEventFor(1n))
        .mockReturnValueOnce(parsedEventFor(1n));

      await service.poll();

      expect(mocks.escrowService.syncStateFromChain).toHaveBeenCalledTimes(3);
      expect(mocks.cursorService.set).toHaveBeenCalledWith('token-3');
      expect(mocks.dlqService.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      { value: 42, expected: 42n },
      { value: '9007199254740993', expected: 9007199254740993n },
    ])(
      'normalizes a numeric or digit-string escrow id ($value) and applies the event',
      async ({ value, expected }) => {
        mockRpcResponse([rawEvent('evt-coercion', 'token-coercion')]);
        mocks.blockchainListener.parseEvent.mockReturnValueOnce(
          parsedEventFor(value),
        );

        await service.poll();

        expect(mocks.escrowService.findIdByContractEscrowId).toHaveBeenCalledWith(
          expected,
        );
        expect(mocks.escrowService.syncStateFromChain).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'EscrowFunded',
            escrowId: 'escrow-1',
          }),
        );
        expect(mocks.cursorService.set).toHaveBeenCalledWith('token-coercion');
        expect(mocks.dlqService.enqueue).not.toHaveBeenCalled();
      },
    );

    it('treats a response without events as an empty batch and leaves the cursor unchanged', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ result: {} }));

      await service.poll();

      expect(mocks.blockchainListener.parseEvent).not.toHaveBeenCalled();
      expect(mocks.escrowService.syncStateFromChain).not.toHaveBeenCalled();
      expect(mocks.dlqService.enqueue).not.toHaveBeenCalled();
      expect(mocks.cursorService.set).not.toHaveBeenCalled();
    });

    it('stops at the middle event that throws and only advances the cursor past the events before it', async () => {
      const events = [
        rawEvent('evt-1', 'token-1'),
        rawEvent('evt-2', 'token-2'),
        rawEvent('evt-3', 'token-3'),
      ];
      mockRpcResponse(events);
      mocks.blockchainListener.parseEvent
        .mockReturnValueOnce(parsedEventFor(1n))
        .mockReturnValueOnce(parsedEventFor(1n))
        .mockReturnValueOnce(parsedEventFor(1n));

      mocks.escrowService.syncStateFromChain
        .mockResolvedValueOnce({ skipped: false })
        .mockRejectedValueOnce(new Error('db unavailable'));

      await service.poll();

      expect(mocks.escrowService.syncStateFromChain).toHaveBeenCalledTimes(2);
      expect(mocks.cursorService.set).toHaveBeenCalledWith('token-1');
      expect(mocks.cursorService.set).not.toHaveBeenCalledWith('token-2');
      expect(mocks.cursorService.set).not.toHaveBeenCalledWith('token-3');
    });

    it('does not advance the cursor at all when the first event throws', async () => {
      const events = [
        rawEvent('evt-1', 'token-1'),
        rawEvent('evt-2', 'token-2'),
      ];
      mockRpcResponse(events);
      mocks.blockchainListener.parseEvent
        .mockReturnValueOnce(parsedEventFor(1n))
        .mockReturnValueOnce(parsedEventFor(1n));

      mocks.escrowService.syncStateFromChain.mockRejectedValueOnce(
        new Error('db unavailable'),
      );

      await service.poll();

      expect(mocks.escrowService.syncStateFromChain).toHaveBeenCalledTimes(1);
      expect(mocks.cursorService.set).not.toHaveBeenCalled();
    });

    it('dead-letters an event with an unparseable payload and still advances the cursor past it', async () => {
      const events = [rawEvent('evt-1', 'token-1')];
      mockRpcResponse(events);
      mocks.blockchainListener.parseEvent.mockReturnValueOnce(null);

      await service.poll();

      expect(mocks.escrowService.syncStateFromChain).not.toHaveBeenCalled();
      expect(mocks.dlqService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'soroban_event_sync',
          escrowId: null,
        }),
      );
      expect(mocks.cursorService.set).toHaveBeenCalledWith('token-1');
    });

    it('dead-letters an event with a missing escrowId and still advances the cursor past it', async () => {
      const events = [rawEvent('evt-1', 'token-1')];
      mockRpcResponse(events);
      mocks.blockchainListener.parseEvent.mockReturnValueOnce({
        contractId: 'CONTRACT',
        type: 'contract',
        ledger: 100,
        name: 'Funded',
        topics: ['Escrow', 'Funded'],
        data: {},
      });

      await service.poll();

      expect(mocks.escrowService.syncStateFromChain).not.toHaveBeenCalled();
      expect(mocks.dlqService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'soroban_event_sync' }),
      );
      expect(mocks.cursorService.set).toHaveBeenCalledWith('token-1');
    });

    it('dead-letters a permanently-failing event after MAX_SYNC_RETRIES and then advances past it', async () => {
      const events = [rawEvent('evt-1', 'token-1')];
      mocks.blockchainListener.parseEvent.mockReturnValue(parsedEventFor(1n));
      mocks.escrowService.syncStateFromChain.mockRejectedValue(
        new Error('permanently broken'),
      );

      for (let i = 0; i < 4; i += 1) {
        mockRpcResponse(events);
        await service.poll();
      }

      expect(mocks.cursorService.set).not.toHaveBeenCalled();
      expect(mocks.dlqService.enqueue).not.toHaveBeenCalled();

      mockRpcResponse(events);
      await service.poll();

      expect(mocks.dlqService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'soroban_event_sync',
          escrowId: 'escrow-1',
        }),
      );
      expect(mocks.cursorService.set).toHaveBeenCalledWith('token-1');
    });
  });
});
