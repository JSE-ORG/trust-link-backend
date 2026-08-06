// Unit tests for SorobanPollerService's cursor-advancement behavior
// (issue #554).
//
// Chosen semantics: stop-at-first-failure. When an event in a batch throws
// during syncStateFromChain, the poller stops processing the rest of that
// batch and does not advance the cursor past the failing event — the next
// poll cycle re-fetches from the same cursor and retries it first. This was
// chosen over "continue and track highest contiguous success" because the
// batch is fetched in ledger order and EscrowService.syncStateFromChain's
// switch cases assume prior transitions already landed (e.g. EscrowShipped
// assumes EscrowFunded already happened) — applying later events out of
// order after skipping a failed one risks a worse, harder-to-detect
// state-machine bug than the at-least-once redelivery this trades for.
//
// Events that are legitimately never applicable (unparseable payload,
// non-string topics, missing escrowId) are a different failure class: no
// retry will ever fix them, so they're dead-lettered via the existing
// DlqService (issue #303) and treated as handled — the cursor advances past
// them rather than blocking on them forever.

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

function parsedEventFor(escrowId: string) {
  return {
    contractId: 'CONTRACT',
    type: 'contract',
    ledger: 100,
    name: 'Funded',
    topics: ['Escrow', 'Funded'],
    data: { escrowId },
  };
}

describe('SorobanPollerService.poll (issue #554)', () => {
  let service: SorobanPollerService;
  let cursorService: jest.Mocked<CursorService>;
  let blockchainListener: jest.Mocked<BlockchainListenerService>;
  let escrowService: jest.Mocked<EscrowService>;
  let dlqService: jest.Mocked<DlqService>;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  function mockRpcResponse(events: ReturnType<typeof rawEvent>[]) {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ result: { events, latestLedger: 200, sequence: 200 } }),
    } as unknown as Response);
  }

  beforeEach(async () => {
    cursorService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CursorService>;

    blockchainListener = {
      parseEvent: jest.fn(),
    } as unknown as jest.Mocked<BlockchainListenerService>;

    escrowService = {
      syncStateFromChain: jest.fn().mockResolvedValue({ skipped: false }),
    } as unknown as jest.Mocked<EscrowService>;

    dlqService = {
      enqueue: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<DlqService>;

    const configValues: Record<string, string> = {
      SOROBAN_RPC_URL: 'https://rpc.example.com',
      CONTRACT_ID: 'CONTRACT',
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

    service = moduleRef.get(SorobanPollerService);

    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('advances the cursor to the last event when all events succeed', async () => {
    const events = [
      rawEvent('evt-1', 'token-1'),
      rawEvent('evt-2', 'token-2'),
      rawEvent('evt-3', 'token-3'),
    ];
    mockRpcResponse(events);
    blockchainListener.parseEvent
      .mockReturnValueOnce(parsedEventFor('escrow-1'))
      .mockReturnValueOnce(parsedEventFor('escrow-2'))
      .mockReturnValueOnce(parsedEventFor('escrow-3'));

    await service.poll();

    expect(escrowService.syncStateFromChain).toHaveBeenCalledTimes(3);
    expect(cursorService.set).toHaveBeenCalledWith('token-3');
    expect(dlqService.enqueue).not.toHaveBeenCalled();
  });

  it('stops at the middle event that throws and only advances the cursor past the events before it', async () => {
    const events = [
      rawEvent('evt-1', 'token-1'),
      rawEvent('evt-2', 'token-2'),
      rawEvent('evt-3', 'token-3'),
    ];
    mockRpcResponse(events);
    blockchainListener.parseEvent
      .mockReturnValueOnce(parsedEventFor('escrow-1'))
      .mockReturnValueOnce(parsedEventFor('escrow-2'))
      .mockReturnValueOnce(parsedEventFor('escrow-3'));

    escrowService.syncStateFromChain
      .mockResolvedValueOnce({ skipped: false }) // escrow-1 succeeds
      .mockRejectedValueOnce(new Error('db unavailable')); // escrow-2 throws

    await service.poll();

    // event 3 must never be reached
    expect(escrowService.syncStateFromChain).toHaveBeenCalledTimes(2);
    expect(cursorService.set).toHaveBeenCalledWith('token-1');
    expect(cursorService.set).not.toHaveBeenCalledWith('token-2');
    expect(cursorService.set).not.toHaveBeenCalledWith('token-3');
  });

  it('does not advance the cursor at all when the first event throws', async () => {
    const events = [rawEvent('evt-1', 'token-1'), rawEvent('evt-2', 'token-2')];
    mockRpcResponse(events);
    blockchainListener.parseEvent
      .mockReturnValueOnce(parsedEventFor('escrow-1'))
      .mockReturnValueOnce(parsedEventFor('escrow-2'));

    escrowService.syncStateFromChain.mockRejectedValueOnce(
      new Error('db unavailable'),
    );

    await service.poll();

    expect(escrowService.syncStateFromChain).toHaveBeenCalledTimes(1);
    expect(cursorService.set).not.toHaveBeenCalled();
  });

  it('dead-letters an event with an unparseable payload and still advances the cursor past it', async () => {
    const events = [rawEvent('evt-1', 'token-1')];
    mockRpcResponse(events);
    blockchainListener.parseEvent.mockReturnValueOnce(null);

    await service.poll();

    expect(escrowService.syncStateFromChain).not.toHaveBeenCalled();
    expect(dlqService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'soroban_event_sync',
        escrowId: null,
      }),
    );
    expect(cursorService.set).toHaveBeenCalledWith('token-1');
  });

  it('dead-letters an event with a missing escrowId and still advances the cursor past it', async () => {
    const events = [rawEvent('evt-1', 'token-1')];
    mockRpcResponse(events);
    blockchainListener.parseEvent.mockReturnValueOnce({
      contractId: 'CONTRACT',
      type: 'contract',
      ledger: 100,
      name: 'Funded',
      topics: ['Escrow', 'Funded'],
      data: {},
    });

    await service.poll();

    expect(escrowService.syncStateFromChain).not.toHaveBeenCalled();
    expect(dlqService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'soroban_event_sync' }),
    );
    expect(cursorService.set).toHaveBeenCalledWith('token-1');
  });

  it('dead-letters a permanently-failing event after MAX_SYNC_RETRIES and then advances past it', async () => {
    // Same event id/pagingToken every cycle — as if the cursor genuinely
    // never moved because every previous attempt threw.
    const events = [rawEvent('evt-1', 'token-1')];
    blockchainListener.parseEvent.mockReturnValue(parsedEventFor('escrow-1'));
    escrowService.syncStateFromChain.mockRejectedValue(
      new Error('permanently broken'),
    );

    for (let i = 0; i < 4; i += 1) {
      mockRpcResponse(events);
      await service.poll();
    }

    // Still under threshold: cursor never advanced, DLQ never used yet.
    expect(cursorService.set).not.toHaveBeenCalled();
    expect(dlqService.enqueue).not.toHaveBeenCalled();

    // 5th attempt trips MAX_SYNC_RETRIES.
    mockRpcResponse(events);
    await service.poll();

    expect(dlqService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'soroban_event_sync',
        escrowId: 'escrow-1',
      }),
    );
    expect(cursorService.set).toHaveBeenCalledWith('token-1');
  });
});
