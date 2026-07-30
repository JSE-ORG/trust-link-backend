// Unit tests for SorobanPollerService's lifecycle, RPC fetch error handling,
// and topic-derivation behavior (issue #559).
//
// The cursor-advancement / retry / dead-letter semantics already have
// dedicated coverage in soroban-poller.service.spec.ts (issue #554). This
// file covers what #559 calls out as otherwise-unverified:
//   - onModuleInit starting (and not starting) the poll timer
//   - onModuleDestroy clearing it
//   - the re-entry guard (a second tick during an in-flight poll is a no-op)
//   - event-name derivation for all six documented topic pairs, plus the
//     non-string-topic rejection
//   - fetchEvents for a non-2xx HTTP response and a JSON-RPC error body
//   - the RPC URL fallback (SOROBAN_RPC_URL override vs STELLAR_NETWORK
//     derived default)

import { Test } from '@nestjs/testing';
import { SorobanPollerService } from '../../src/stellar/soroban-poller.service';
import { ConfigService } from '../../src/config/config.service';
import { BlockchainListenerService } from '../../src/stellar/blockchain-listener.service';
import { CursorService } from '../../src/stellar/cursor.service';
import { EscrowService } from '../../src/escrow/escrow.service';
import { DlqService } from '../../src/dlq/dlq.service';

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

function parsedEventFor(
  escrowId: string,
  topics: unknown[] = ['Escrow', 'Funded'],
) {
  return {
    contractId: 'CONTRACT',
    type: 'contract',
    ledger: 100,
    name: 'Funded',
    topics,
    data: { escrowId },
  };
}

async function buildService(configOverrides: Record<string, string> = {}) {
  const cursorService = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CursorService>;

  const blockchainListener = {
    parseEvent: jest.fn(),
  } as unknown as jest.Mocked<BlockchainListenerService>;

  const escrowService = {
    syncStateFromChain: jest.fn().mockResolvedValue({ skipped: false }),
  } as unknown as jest.Mocked<EscrowService>;

  const dlqService = {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<DlqService>;

  const configValues: Record<string, string> = {
    SOROBAN_RPC_URL: 'https://rpc.example.com',
    CONTRACT_ID: 'CONTRACT',
    ...configOverrides,
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  const moduleRef = await Test.createTestingModule({
    providers: [
      SorobanPollerService,
      { provide: ConfigService, useValue: configService },
      { provide: BlockchainListenerService, useValue: blockchainListener },
      { provide: CursorService, useValue: cursorService },
      { provide: EscrowService, useValue: escrowService },
      { provide: DlqService, useValue: dlqService },
    ],
  }).compile();

  return {
    service: moduleRef.get(SorobanPollerService),
    cursorService,
    blockchainListener,
    escrowService,
    dlqService,
  };
}

function mockRpcResponse(
  fetchSpy: jest.SpiedFunction<typeof fetch>,
  events: ReturnType<typeof rawEvent>[],
) {
  fetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ result: { events, latestLedger: 200 } }),
  } as unknown as Response);
}

describe('SorobanPollerService — lifecycle (issue #559)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts the poll timer and kicks off an immediate poll when rpcUrl and contractId are configured', async () => {
    const { service } = await buildService();
    mockRpcResponse(fetchSpy, []);

    service.onModuleInit();
    // Immediate kick-off happens without waiting for the interval tick.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
  });

  it('does not start the timer when CONTRACT_ID is not set', async () => {
    const { service } = await buildService({ CONTRACT_ID: '' });
    mockRpcResponse(fetchSpy, []);

    service.onModuleInit();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clears the timer on onModuleDestroy so no further polls fire', async () => {
    const { service } = await buildService();
    mockRpcResponse(fetchSpy, []);

    service.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);

    // Still just the one immediate poll from onModuleInit — destroy stopped the interval.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-entry guard: a second tick during an in-flight poll is a no-op', async () => {
    const { service, cursorService } = await buildService();
    let resolveFetch: (value: unknown) => void;
    fetchSpy.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as unknown as Promise<Response>,
    );

    const firstPoll = service.poll();
    // Second call while the first is still in-flight (cursorService.get()
    // has already resolved and fetch is pending).
    await Promise.resolve();
    await Promise.resolve();
    const secondPoll = service.poll();

    expect(cursorService.get).toHaveBeenCalledTimes(1);

    resolveFetch!({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ result: { events: [], latestLedger: 1 } }),
    });

    await firstPoll;
    await secondPoll;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the RPC returns no new events', async () => {
    const { service, cursorService, escrowService } = await buildService();
    mockRpcResponse(fetchSpy, []);

    await service.poll();

    expect(escrowService.syncStateFromChain).not.toHaveBeenCalled();
    expect(cursorService.set).not.toHaveBeenCalled();
  });
});

describe('SorobanPollerService — RPC fetch error handling (issue #559)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs and does not throw when the RPC responds with a non-2xx HTTP status', async () => {
    const { service, cursorService, escrowService } = await buildService();
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as unknown as Response);

    await expect(service.poll()).resolves.toBeUndefined();

    expect(escrowService.syncStateFromChain).not.toHaveBeenCalled();
    expect(cursorService.set).not.toHaveBeenCalled();
  });

  it('logs and does not throw on a JSON-RPC error body', async () => {
    const { service, cursorService, escrowService } = await buildService();
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ error: { message: 'bad cursor' } }),
    } as unknown as Response);

    await expect(service.poll()).resolves.toBeUndefined();

    expect(escrowService.syncStateFromChain).not.toHaveBeenCalled();
    expect(cursorService.set).not.toHaveBeenCalled();
  });
});

describe('SorobanPollerService — event-name derivation (issue #559)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cases: Array<[string, string, string]> = [
    ['Escrow', 'Funded', 'EscrowFunded'],
    ['Escrow', 'Shipped', 'EscrowShipped'],
    ['Escrow', 'Completed', 'EscrowCompleted'],
    ['Dispute', 'Raised', 'DisputeRaised'],
    ['Dispute', 'Resolved', 'DisputeResolved'],
    ['Auto', 'Released', 'AutoReleased'],
  ];

  it.each(cases)(
    'derives "%s" + "%s" -> "%s"',
    async (topic0, topic1, expected) => {
      const { service, blockchainListener, escrowService } =
        await buildService();
      mockRpcResponse(fetchSpy, [rawEvent('evt-1', 'token-1')]);
      blockchainListener.parseEvent.mockReturnValueOnce(
        parsedEventFor('escrow-1', [topic0, topic1]),
      );

      await service.poll();

      expect(escrowService.syncStateFromChain).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: expected, escrowId: 'escrow-1' }),
      );
    },
  );

  it('dead-letters an event with non-string topics and still advances the cursor past it', async () => {
    const {
      service,
      blockchainListener,
      escrowService,
      dlqService,
      cursorService,
    } = await buildService();
    mockRpcResponse(fetchSpy, [rawEvent('evt-1', 'token-1')]);
    blockchainListener.parseEvent.mockReturnValueOnce(
      parsedEventFor('escrow-1', [42, null]),
    );

    await service.poll();

    expect(escrowService.syncStateFromChain).not.toHaveBeenCalled();
    expect(dlqService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'soroban_event_sync' }),
    );
    expect(cursorService.set).toHaveBeenCalledWith('token-1');
  });
});

describe('SorobanPollerService — RPC URL resolution (issue #559)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses SOROBAN_RPC_URL when explicitly configured', async () => {
    const { service } = await buildService({
      SOROBAN_RPC_URL: 'https://custom-rpc.example.com',
    });
    mockRpcResponse(fetchSpy, []);

    await service.poll();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://custom-rpc.example.com',
      expect.anything(),
    );
  });

  it('falls back to the mainnet RPC URL when unset and STELLAR_NETWORK is MAINNET', async () => {
    const { service } = await buildService({
      SOROBAN_RPC_URL: '',
      STELLAR_NETWORK: 'MAINNET',
    });
    mockRpcResponse(fetchSpy, []);

    await service.poll();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
      expect.anything(),
    );
  });

  it('falls back to the public testnet RPC URL when unset and not MAINNET', async () => {
    const { service } = await buildService({
      SOROBAN_RPC_URL: '',
      STELLAR_NETWORK: 'TESTNET',
    });
    mockRpcResponse(fetchSpy, []);

    await service.poll();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://soroban-testnet.stellar.org',
      expect.anything(),
    );
  });
});
