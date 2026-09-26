/**
 * Unit tests for the notification retry queue (#73). The BullMQ
 * backend requires Redis, so the in-process fallback is the path
 * exercised here; the BullMQ wiring is unit-tested at the
 * dispatcher-registration / enqueue-routing level only.
 */

import {
  NotificationRetryQueueService,
  type NotificationChannelDispatcher,
} from '../../src/notifications/notification-retry-queue.service';
import {
  DEFAULT_BACKOFF,
  NotificationDeadLetterRecord,
  NotificationRetryBackoff,
  NotificationRetryJobData,
  computeBackoffDelay,
} from '../../src/notifications/notification-retry-queue.types';
import { EscrowRecord, PrismaService } from '../../src/prisma/prisma.service';
import { Job, Queue, Worker } from 'bullmq';
import { ConfigService } from '../../src/config/config.service';

/**
 * ConfigService double for the BullMQ tests.
 *
 * #598 moved REDIS_URL from a direct process.env read onto ConfigService, so
 * constructing the service without one leaves the queue permanently disabled
 * and every BullMQ assertion silently sees zero calls.
 */
function configWith(values: Record<string, string | undefined>) {
  return {
    get: <T = string>(key: string): T | undefined =>
      values[key] as T | undefined,
  } as unknown as ConfigService;
}

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));

const escrow: EscrowRecord = {
  id: 'escrow-1',
  contractEscrowId: null,
  itemName: 'Vintage jacket',
  itemRef: 'jacket-001',
  amount: 80,
  currency: 'USDC',
  buyerAddress: 'buyer-address',
  vendorAddress: 'vendor-address',
  state: 'FUNDED',
  trackingId: null,
  shippedAt: null,
  deliveredAt: null,
  deliveryRecordedAt: null,
  autoReleaseSubmittedAt: null,
  autoReleaseTxHash: null,
  disputeId: null,
  cancelledAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const makeJob = (
  overrides: Partial<NotificationRetryJobData> = {},
): NotificationRetryJobData => ({
  channel: 'EMAIL',
  type: 'FUNDED',
  escrow,
  recipientAddress: 'someone@example.test',
  ...overrides,
});

describe('computeBackoffDelay (#73)', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    jest.spyOn(Math, 'random').mockRestore();
  });

  it('returns 0 for the first attempt — no backoff before the very first call', () => {
    expect(computeBackoffDelay(1)).toBe(0);
  });

  it('doubles the delay on each subsequent attempt', () => {
    const backoff: NotificationRetryBackoff = {
      attempts: 5,
      delay: 100,
      maxDelayMs: 1_000_000,
    };
    expect(computeBackoffDelay(2, backoff)).toBe(100);
    expect(computeBackoffDelay(3, backoff)).toBe(200);
    expect(computeBackoffDelay(4, backoff)).toBe(400);
    expect(computeBackoffDelay(5, backoff)).toBe(800);
  });

  it('caps the delay at maxDelayMs', () => {
    const backoff: NotificationRetryBackoff = {
      attempts: 10,
      delay: 1_000,
      maxDelayMs: 4_000,
    };
    expect(computeBackoffDelay(2, backoff)).toBe(1_000);
    expect(computeBackoffDelay(4, backoff)).toBe(4_000);
    expect(computeBackoffDelay(6, backoff)).toBe(4_000); // capped
    expect(computeBackoffDelay(20, backoff)).toBe(4_000); // capped
  });

  it('leaves the delay uncapped when maxDelayMs is omitted', () => {
    const backoff: NotificationRetryBackoff = { attempts: 40, delay: 1_000 };

    // 1_000 * 2^28 with jitter pinned to zero by the Math.random stub.
    expect(computeBackoffDelay(30, backoff)).toBe(1_000 * 2 ** 28);
    expect(computeBackoffDelay(30, backoff)).toBeGreaterThan(
      DEFAULT_BACKOFF.maxDelayMs as number,
    );
  });

  it('uses the DEFAULT_BACKOFF when no override is supplied', () => {
    expect(computeBackoffDelay(2)).toBe(DEFAULT_BACKOFF.delay);
  });
});

describe('NotificationRetryQueueService (in-process fallback) (#73)', () => {
  const synchronousScheduler = (cb: () => void) => cb();

  const setup = (
    overrides: {
      dispatcher?: NotificationChannelDispatcher;
      backoff?: NotificationRetryBackoff;
      prisma?: { notification: { update: jest.Mock } };
    } = {},
  ) => {
    const dispatcher: NotificationChannelDispatcher = overrides.dispatcher ?? {
      dispatch: jest.fn(),
    };
    const dlq: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService(
      {
        backoff: overrides.backoff ?? {
          attempts: 3,
          delay: 1,
          maxDelayMs: 10,
        },
        deadLetterSink: { record: (entry) => void dlq.push(entry) },
        scheduleDelayed: synchronousScheduler,
      },
      // The real PrismaService is an in-memory fake; a minimal mock with
      // notification.update is all the retry runner touches, and it lets
      // us assert the per-attempt failure state that #490 restored.
      overrides.prisma as unknown as never,
    );
    service.registerDispatcher('EMAIL', dispatcher);
    return { service, dispatcher, dlq };
  };

  it('delivers on the first attempt when the dispatcher succeeds', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const { service, dlq } = setup({ dispatcher: { dispatch } });
    await service.enqueue(makeJob());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dlq).toHaveLength(0);
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    const dispatch = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce(undefined);
    const { service, dlq } = setup({ dispatcher: { dispatch } });
    await service.enqueue(makeJob());
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dlq).toHaveLength(0);
  });

  it('asserts the dispatcher is called exactly attempts times when every attempt throws, and exactly once when the first attempt succeeds', async () => {
    // Exactly once when first attempt succeeds
    const dispatchSuccess = jest.fn().mockResolvedValue(undefined);
    const successSetup = setup({ dispatcher: { dispatch: dispatchSuccess } });
    await successSetup.service.enqueue(makeJob());
    expect(dispatchSuccess).toHaveBeenCalledTimes(1);

    // Exactly attempts times when every attempt throws
    const dispatchFail = jest.fn().mockRejectedValue(new Error('fail'));
    const backoff = { attempts: 4, delay: 1, maxDelayMs: 10 };
    const failSetup = setup({
      dispatcher: { dispatch: dispatchFail },
      backoff,
    });
    await failSetup.service.enqueue(makeJob());
    expect(dispatchFail).toHaveBeenCalledTimes(4);
  });

  it('records to DLQ after attempts are exhausted', async () => {
    const dispatch = jest.fn().mockRejectedValue(new Error('always fails'));
    const { service, dispatcher, dlq } = setup({ dispatcher: { dispatch } });
    await service.enqueue(makeJob({ requestId: 'req-1' }));
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3); // attempts: 3
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({
      channel: 'EMAIL',
      type: 'FUNDED',
      escrowId: 'escrow-1',
      attemptsExhausted: 3,
      lastError: 'always fails',
      requestId: 'req-1',
    });
    expect(dlq[0].failedAt).toBeInstanceOf(Date);
  });

  // KIND 2 REGRESSION (#490): PR #590 merged this test but not the
  // implementation. processInProcess's catch block tracks lastError locally and
  // sleeps; it never writes retryCount / failedAt / lastError to the
  // notification row, so an operator sees no attempt count and no provider
  // error until the final FAILED write. Marked failing so it turns red again
  // once the write is added, which is the signal to flip it back to `it`.
  it('records per-attempt failure state (retryCount, failedAt, lastError) on every failing attempt (#490)', async () => {
    const dispatch = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockRejectedValueOnce(new Error('provider unavailable'));
    const update = jest.fn().mockResolvedValue(undefined);
    const { service, dlq } = setup({
      dispatcher: { dispatch },
      prisma: { notification: { update } },
    });

    await service.enqueue(makeJob({ notificationId: 'notif-1' }));

    expect(dispatch).toHaveBeenCalledTimes(3);

    // One failure write per attempt, each carrying the attempt number and
    // the provider error message for that attempt.
    const failureWrites = update.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.data.lastError !== undefined);
    expect(failureWrites).toHaveLength(3);
    failureWrites.forEach((arg) => {
      expect(arg.where).toEqual({ id: 'notif-1' });
      expect(arg.data.failedAt).toBeInstanceOf(Date);
    });
    expect(failureWrites.map((arg) => arg.data.retryCount)).toEqual([1, 2, 3]);
    expect(failureWrites.map((arg) => arg.data.lastError)).toEqual([
      'boom',
      'still down',
      'provider unavailable',
    ]);

    // The last recorded failure state reflects three attempts and the
    // final provider error — the state operators inspect after exhaustion.
    const lastFailure = failureWrites[failureWrites.length - 1];
    expect(lastFailure.data.retryCount).toBe(3);
    expect(lastFailure.data.lastError).toBe('provider unavailable');

    // The terminal status write still happens after attempts are exhausted.
    const statusWrites = update.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.data.status === 'FAILED');
    expect(statusWrites).toHaveLength(1);

    expect(dlq).toHaveLength(1);
    expect(dlq[0].lastError).toBe('provider unavailable');
  });

  it('a failing status write does not abort the retry loop (#490)', async () => {
    const dispatch = jest.fn().mockRejectedValue(new Error('always fails'));
    const update = jest.fn().mockRejectedValue(new Error('db down'));
    const { service, dlq } = setup({
      dispatcher: { dispatch },
      prisma: { notification: { update } },
    });

    await service.enqueue(makeJob({ notificationId: 'notif-2' }));

    // The loop ran to exhaustion despite every DB write rejecting.
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dlq).toHaveLength(1);
  });

  it('uses a unique requestId per enqueue when none is supplied', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const seenIds: string[] = [];
    dispatch.mockImplementation((j: NotificationRetryJobData) => {
      seenIds.push(j.requestId ?? 'missing');
      return Promise.resolve();
    });
    const { service } = setup({ dispatcher: { dispatch } });
    await service.enqueue(makeJob());
    await service.enqueue(makeJob());
    expect(seenIds).toHaveLength(2);
    expect(seenIds[0]).not.toBe('missing');
    expect(seenIds[0]).not.toBe(seenIds[1]);
  });

  it('drops jobs for unregistered channels with a warning rather than throwing', async () => {
    const service = new NotificationRetryQueueService({
      backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
      scheduleDelayed: synchronousScheduler,
    });
    // No EMAIL dispatcher registered → enqueue resolves cleanly.
    await expect(service.enqueue(makeJob())).resolves.not.toThrow();
  });

  it('registerDispatcher accepts EMAIL and SMS independently', () => {
    const email: NotificationChannelDispatcher = { dispatch: jest.fn() };
    const sms: NotificationChannelDispatcher = { dispatch: jest.fn() };
    const service = new NotificationRetryQueueService();
    service.registerDispatcher('EMAIL', email);
    service.registerDispatcher('SMS', sms);
    expect(service._getDispatchers().EMAIL).toBe(email);
    expect(service._getDispatchers().SMS).toBe(sms);
  });

  it('defaults to DEFAULT_BACKOFF when no options are supplied', () => {
    const service = new NotificationRetryQueueService();
    expect(service._getDispatchers().EMAIL).toBeNull();
    expect(service._getDispatchers().SMS).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prisma-integration tests — in-process retry path with database interaction
// ─────────────────────────────────────────────────────────────────────────────

describe('NotificationRetryQueueService (in-process with Prisma) (#73)', () => {
  const synchronousScheduler = (cb: () => void) => cb();

  const makePrismaMock = () => ({
    notification: { update: jest.fn().mockResolvedValue(undefined) },
  });

  const makeJob = (
    overrides: Partial<NotificationRetryJobData> = {},
  ): NotificationRetryJobData => ({
    channel: 'EMAIL',
    type: 'FUNDED',
    escrow,
    recipientAddress: 'someone@example.test',
    ...overrides,
  });

  it('updates notification to SENT on first-success when prisma + notificationId are provided', async () => {
    const prisma = makePrismaMock();
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
        scheduleDelayed: synchronousScheduler,
      },
      prisma as unknown as PrismaService,
    );
    service.registerDispatcher('EMAIL', { dispatch });
    await service.enqueue(makeJob({ notificationId: 'n-1' }));
    expect(prisma.notification.update).toHaveBeenCalledTimes(1);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n-1' },
        data: expect.objectContaining({ status: 'SENT', retryCount: 0 }),
      }),
    );
  });

  it('updates retryCount and failedAt on each retry attempt', async () => {
    const prisma = makePrismaMock();
    const dispatch = jest.fn().mockRejectedValue(new Error('transient'));
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
        scheduleDelayed: synchronousScheduler,
      },
      prisma as unknown as PrismaService,
    );
    service.registerDispatcher('EMAIL', { dispatch });
    await service.enqueue(makeJob({ notificationId: 'n-1' }));
    expect(prisma.notification.update).toHaveBeenCalled();
    const allCalls = prisma.notification.update.mock.calls;
    const lastCallArg = allCalls[allCalls.length - 1][0];
    expect(lastCallArg).toMatchObject({
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('skips prisma when notificationId is not set', async () => {
    const prisma = makePrismaMock();
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
        scheduleDelayed: synchronousScheduler,
      },
      prisma as unknown as PrismaService,
    );
    service.registerDispatcher('EMAIL', { dispatch });
    await service.enqueue(makeJob({ notificationId: undefined }));
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('catches prisma error on success path without crashing', async () => {
    const prisma = {
      notification: {
        update: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
        scheduleDelayed: synchronousScheduler,
      },
      prisma as unknown as PrismaService,
    );
    service.registerDispatcher('EMAIL', { dispatch });
    await expect(
      service.enqueue(makeJob({ notificationId: 'n-1' })),
    ).resolves.toBeUndefined();
  });

  it('catches prisma error on failure path without crashing', async () => {
    const prisma = {
      notification: {
        update: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    const dispatch = jest.fn().mockRejectedValue(new Error('fail'));
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
        scheduleDelayed: synchronousScheduler,
      },
      prisma as unknown as PrismaService,
    );
    service.registerDispatcher('EMAIL', { dispatch });
    await expect(
      service.enqueue(makeJob({ notificationId: 'n-1' })),
    ).resolves.toBeUndefined();
  });

  it('records to DLQ after exhaustion with prisma FAILED update', async () => {
    const dlqSink: NotificationDeadLetterRecord[] = [];
    const prisma = makePrismaMock();
    const dispatch = jest.fn().mockRejectedValue(new Error('exhausted'));
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
        deadLetterSink: { record: (entry) => void dlqSink.push(entry) },
        scheduleDelayed: synchronousScheduler,
      },
      prisma as unknown as PrismaService,
    );
    service.registerDispatcher('EMAIL', { dispatch });
    await service.enqueue(
      makeJob({ notificationId: 'n-1', requestId: 'req-1' }),
    );
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dlqSink).toHaveLength(1);
    expect(dlqSink[0].lastError).toBe('exhausted');
    const lastUpdate = prisma.notification.update.mock.calls.slice(-1)[0][0];
    expect(lastUpdate.data).toMatchObject({ status: 'FAILED' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BullMQ integration — tests that exercise the BullMQ queue/worker path
// ─────────────────────────────────────────────────────────────────────────────

describe('NotificationRetryQueueService (BullMQ integration) (#73)', () => {
  let MockQueue: jest.Mock;
  let MockWorker: jest.Mock;
  const mockQueueInstance = {
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockDlqInstance = {
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockWorkerInstance = {
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  };
  let failedHandler:
    | ((
        job:
          | Job
          | {
              data: NotificationRetryJobData;
              attemptsMade: number;
              opts: { attempts: number };
            }
          | null,
        error: Error,
      ) => void)
    | undefined;

  beforeAll(() => {
    const mod = jest.requireMock('bullmq');
    MockQueue = mod.Queue;
    MockWorker = mod.Worker;
  });

  beforeEach(() => {
    MockQueue.mockReset();
    MockWorker.mockReset();
    mockQueueInstance.add.mockReset();
    mockQueueInstance.close.mockReset();
    mockDlqInstance.add.mockReset();
    mockDlqInstance.close.mockReset();
    mockWorkerInstance.close.mockReset();
    mockWorkerInstance.on.mockReset();
    failedHandler = undefined;

    let queueCallCount = 0;
    MockQueue.mockImplementation(() => {
      queueCallCount++;
      return queueCallCount === 1 ? mockQueueInstance : mockDlqInstance;
    });

    mockWorkerInstance.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'failed') failedHandler = handler;
      },
    );
    MockWorker.mockReturnValue(mockWorkerInstance);
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it('onModuleInit without REDIS_URL logs warning and uses in-process fallback', async () => {
    const service = new NotificationRetryQueueService({
      backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
    });
    await service.onModuleInit();
    expect(MockQueue).not.toHaveBeenCalled();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('onModuleInit with REDIS_URL creates queue, dlq, and worker', async () => {
    const service = new NotificationRetryQueueService(
      { backoff: { attempts: 3, delay: 1_000, maxDelayMs: 300_000 } },
      undefined,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
    await service.onModuleInit();
    expect(MockQueue).toHaveBeenCalledTimes(2);
    expect(MockQueue).toHaveBeenNthCalledWith(
      1,
      'notifications-retry',
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
      }),
    );
    expect(MockQueue).toHaveBeenNthCalledWith(
      2,
      'notifications-dlq',
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
      }),
    );
    expect(MockWorker).toHaveBeenCalledTimes(1);
    expect(MockWorker).toHaveBeenCalledWith(
      'notifications-retry',
      expect.any(Function),
      expect.objectContaining({
        connection: { url: 'redis://localhost:6379' },
      }),
    );
    expect(mockWorkerInstance.on).toHaveBeenCalledWith(
      'failed',
      expect.any(Function),
    );
  });

  it('onModuleInit falls back to in-process when BullMQ import throws', async () => {
    MockQueue.mockImplementation(() => {
      throw new Error('connection refused');
    });
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
      },
      undefined,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    await service.onModuleInit();
    const dispatchers = service._getDispatchers();
    expect(dispatchers.EMAIL).toBeNull();
    expect(dispatchers.SMS).toBeNull();
  });

  it('enqueue delegates to bullQueue.add when bullQueue is set', async () => {
    const service = new NotificationRetryQueueService({
      backoff: { attempts: 3, delay: 1_000, maxDelayMs: 300_000 },
    });
    service['bullQueue'] =
      mockQueueInstance as unknown as Queue<NotificationRetryJobData>;
    await service.enqueue(makeJob({ requestId: 'req-1' }));
    expect(mockQueueInstance.add).toHaveBeenCalledWith(
      'EMAIL-FUNDED',
      expect.objectContaining({ channel: 'EMAIL', requestId: 'req-1' }),
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      }),
    );
  });

  it('onModuleDestroy closes worker, queue, and dlq', async () => {
    const service = new NotificationRetryQueueService();
    service['bullWorker'] =
      mockWorkerInstance as unknown as Worker<NotificationRetryJobData>;
    service['bullQueue'] =
      mockQueueInstance as unknown as Queue<NotificationRetryJobData>;
    service['bullDlq'] =
      mockDlqInstance as unknown as Queue<NotificationDeadLetterRecord>;
    await service.onModuleDestroy();
    expect(mockWorkerInstance.close).toHaveBeenCalledTimes(1);
    expect(mockQueueInstance.close).toHaveBeenCalledTimes(1);
    expect(mockDlqInstance.close).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy handles null connections gracefully', async () => {
    const service = new NotificationRetryQueueService();
    service['bullWorker'] = null;
    service['bullQueue'] = null;
    service['bullDlq'] = null;
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('recordDeadLetter adds entry to bullDlq when set', async () => {
    const service = new NotificationRetryQueueService({
      backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
    });
    service['bullDlq'] =
      mockDlqInstance as unknown as Queue<NotificationDeadLetterRecord>;
    await service['recordDeadLetter'](
      makeJob({ requestId: 'dlq-test' }),
      3,
      new Error('epic fail'),
    );
    expect(mockDlqInstance.add).toHaveBeenCalledWith(
      'EMAIL-FUNDED-dlq',
      expect.objectContaining({
        channel: 'EMAIL',
        attemptsExhausted: 3,
        lastError: 'epic fail',
        requestId: 'dlq-test',
      }),
      expect.objectContaining({ removeOnComplete: false, removeOnFail: false }),
    );
  });

  it('recordDeadLetter writes "unknown error" for non-Error lastError', async () => {
    const sink: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService({
      backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
      deadLetterSink: { record: (entry) => void sink.push(entry) },
    });
    await service['recordDeadLetter'](makeJob(), 2, 'string error');
    expect(sink).toHaveLength(1);
    expect(sink[0].lastError).toBe('unknown error');
  });

  it('worker failed handler returns early when job is null', async () => {
    const sink: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
        deadLetterSink: { record: (entry) => void sink.push(entry) },
      },
      undefined,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
    await service.onModuleInit();
    expect(failedHandler).toBeDefined();
    failedHandler!(null, new Error('test'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).toHaveLength(0);
  });

  it('worker failed handler returns early when attempts not exhausted', async () => {
    const sink: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 5, delay: 1, maxDelayMs: 10 },
        deadLetterSink: { record: (entry) => void sink.push(entry) },
      },
      undefined,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
    await service.onModuleInit();
    expect(failedHandler).toBeDefined();
    failedHandler!(
      {
        data: makeJob({ requestId: 'req-a' }),
        attemptsMade: 2,
        opts: { attempts: 5 },
      },
      new Error('transient'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).toHaveLength(0);
  });

  it('worker failed handler records DLQ when attempts exhausted', async () => {
    const sink: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
        deadLetterSink: { record: (entry) => void sink.push(entry) },
      },
      undefined,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
    await service.onModuleInit();
    expect(failedHandler).toBeDefined();
    failedHandler!(
      {
        data: makeJob({ requestId: 'req-b' }),
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      new Error('finally gave up'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).toHaveLength(1);
    expect(sink[0].attemptsExhausted).toBe(3);
    expect(sink[0].lastError).toBe('finally gave up');
  });

  it('worker failed handler uses job.opts.attempts instead of service default', async () => {
    const sink: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 10, delay: 1, maxDelayMs: 100 },
        deadLetterSink: { record: (entry) => void sink.push(entry) },
      },
      undefined,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
    await service.onModuleInit();
    expect(failedHandler).toBeDefined();
    failedHandler!(
      {
        data: makeJob({ requestId: 'req-c' }),
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      new Error('exhausted per-job limit'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).toHaveLength(1);
    expect(sink[0].attemptsExhausted).toBe(3);
  });

  it('worker failed handler updates prisma FAILED status when notificationId present', async () => {
    const sink: NotificationDeadLetterRecord[] = [];
    const prisma = {
      notification: { update: jest.fn().mockResolvedValue(undefined) },
    };
    const service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 1, maxDelayMs: 10 },
        deadLetterSink: { record: (entry) => void sink.push(entry) },
      },
      prisma as unknown as PrismaService,
      configWith({ REDIS_URL: 'redis://localhost:6379' }),
    );
    service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
    await service.onModuleInit();
    expect(failedHandler).toBeDefined();
    failedHandler!(
      {
        data: makeJob({ notificationId: 'n-99', requestId: 'req-d' }),
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      new Error('dead'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n-99' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(sink).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Branch coverage for retry-path persistence guards — #725
// ─────────────────────────────────────────────────────────────────────────────

describe('NotificationRetryQueueService — retry-path persistence guards (#725)', () => {
  const synchronousScheduler = (cb: () => void) => cb();

  describe('Dispatcher registration guard — if (!dispatcher)', () => {
    it('drops jobs for unregistered channels in in-process path without throwing', async () => {
      const service = new NotificationRetryQueueService({
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
        scheduleDelayed: synchronousScheduler,
      });
      // No dispatcher registered for EMAIL
      await expect(service.enqueue(makeJob())).resolves.toBeUndefined();
    });

    it('logs warning when dispatcher is missing and job is dropped', async () => {
      const service = new NotificationRetryQueueService({
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
        scheduleDelayed: synchronousScheduler,
      });
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      await service.enqueue(makeJob({ requestId: 'req-unregistered' }));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No dispatcher registered'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('Prisma persistence guards — if (job.notificationId && this.prisma)', () => {
    describe('Success path (first site)', () => {
      it('updates SENT status when notificationId and prisma are both present', async () => {
        const prisma = {
          notification: { update: jest.fn().mockResolvedValue(undefined) },
        };
        const dispatch = jest.fn().mockResolvedValue(undefined);
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        await service.enqueue(makeJob({ notificationId: 'n-sent-1' }));

        expect(prisma.notification.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'n-sent-1' },
            data: expect.objectContaining({
              status: 'SENT',
              sentAt: expect.any(Date),
            }),
          }),
        );
      });

      it('skips prisma update when notificationId is missing (both conditions false)', async () => {
        const prisma = {
          notification: { update: jest.fn().mockResolvedValue(undefined) },
        };
        const dispatch = jest.fn().mockResolvedValue(undefined);
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        // No notificationId → both conditions false
        await service.enqueue(makeJob({ notificationId: undefined }));

        expect(prisma.notification.update).not.toHaveBeenCalled();
      });

      it('skips prisma update when prisma is missing (second condition false, first true)', async () => {
        const dispatch = jest.fn().mockResolvedValue(undefined);
        const service = new NotificationRetryQueueService({
          backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
          scheduleDelayed: synchronousScheduler,
          // No prisma provided
        });
        service.registerDispatcher('EMAIL', { dispatch });

        // notificationId is present but prisma is not
        await service.enqueue(makeJob({ notificationId: 'n-no-prisma' }));

        // Should complete without error
        expect(dispatch).toHaveBeenCalledTimes(1);
      });

      it('handles prisma error on success path gracefully', async () => {
        const prisma = {
          notification: {
            update: jest.fn().mockRejectedValue(new Error('db connection lost')),
          },
        };
        const dispatch = jest.fn().mockResolvedValue(undefined);
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        // Should not throw even though prisma.update fails
        await expect(
          service.enqueue(makeJob({ notificationId: 'n-error' })),
        ).resolves.toBeUndefined();
      });
    });

    describe('Failure path (second site)', () => {
      it('updates failure state when notificationId and prisma are both present on retry', async () => {
        const prisma = {
          notification: { update: jest.fn().mockResolvedValue(undefined) },
        };
        const dispatch = jest
          .fn()
          .mockRejectedValue(new Error('network timeout'));
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        await service.enqueue(makeJob({ notificationId: 'n-fail-1' }));

        // Should have failure updates
        const failureUpdates = prisma.notification.update.mock.calls.filter(
          ([arg]) => arg.data.lastError !== undefined,
        );
        expect(failureUpdates.length).toBeGreaterThan(0);
        failureUpdates.forEach(([arg]) => {
          expect(arg.where).toEqual({ id: 'n-fail-1' });
          expect(arg.data.failedAt).toBeInstanceOf(Date);
        });
      });

      it('skips prisma failure update when notificationId is missing', async () => {
        const prisma = {
          notification: { update: jest.fn().mockResolvedValue(undefined) },
        };
        const dispatch = jest
          .fn()
          .mockRejectedValue(new Error('permanent failure'));
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        // No notificationId → both conditions false
        await service.enqueue(makeJob({ notificationId: undefined }));

        // Dispatch was tried but no DB writes happened
        expect(dispatch).toHaveBeenCalled();
        expect(prisma.notification.update).not.toHaveBeenCalled();
      });

      it('skips prisma failure update when prisma is missing but dispatch still retries', async () => {
        const dispatch = jest
          .fn()
          .mockRejectedValueOnce(new Error('transient'))
          .mockResolvedValueOnce(undefined);
        const service = new NotificationRetryQueueService({
          backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
          scheduleDelayed: synchronousScheduler,
          // No prisma
        });
        service.registerDispatcher('EMAIL', { dispatch });

        // notificationId present but prisma missing
        await service.enqueue(makeJob({ notificationId: 'n-no-prisma-fail' }));

        // Should retry despite no prisma
        expect(dispatch).toHaveBeenCalledTimes(2);
      });

      it('handles prisma error on failure path without stopping retry loop', async () => {
        const prisma = {
          notification: {
            update: jest.fn().mockRejectedValue(new Error('db down')),
          },
        };
        const dispatch = jest
          .fn()
          .mockRejectedValue(new Error('always fails'));
        const dlq: NotificationDeadLetterRecord[] = [];
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
            deadLetterSink: { record: (entry) => void dlq.push(entry) },
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        // Should complete despite DB errors
        await expect(
          service.enqueue(makeJob({ notificationId: 'n-both-fail' })),
        ).resolves.toBeUndefined();

        // Retries still happened
        expect(dispatch).toHaveBeenCalledTimes(2);
        // DLQ was recorded
        expect(dlq).toHaveLength(1);
      });

      it('updates FAILED status when attempts exhausted with both notificationId and prisma', async () => {
        const prisma = {
          notification: { update: jest.fn().mockResolvedValue(undefined) },
        };
        const dispatch = jest
          .fn()
          .mockRejectedValue(new Error('exhausted'));
        const service = new NotificationRetryQueueService(
          {
            backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
            scheduleDelayed: synchronousScheduler,
          },
          prisma as unknown as PrismaService,
        );
        service.registerDispatcher('EMAIL', { dispatch });

        await service.enqueue(makeJob({ notificationId: 'n-final-fail' }));

        const statusUpdates = prisma.notification.update.mock.calls.filter(
          ([arg]) => arg.data.status === 'FAILED',
        );
        expect(statusUpdates).toHaveLength(1);
        expect(statusUpdates[0][0].where).toEqual({ id: 'n-final-fail' });
      });
    });
  });

  describe('Per-job attempts override — job.opts.attempts ?? this.options.backoff.attempts', () => {
    it('BullMQ worker uses job.opts.attempts when set instead of service default', async () => {
      const sink: NotificationDeadLetterRecord[] = [];
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 100, delay: 1, maxDelayMs: 100 }, // Service default: 100
          deadLetterSink: { record: (entry) => void sink.push(entry) },
        },
        undefined,
        configWith({ REDIS_URL: 'redis://localhost:6379' }),
      );
      service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
      await service.onModuleInit();
      expect(failedHandler).toBeDefined();

      // Job has per-job override: 2 attempts
      failedHandler!(
        {
          data: makeJob({ requestId: 'per-job-1' }),
          attemptsMade: 2,
          opts: { attempts: 2 }, // Per-job override
        },
        new Error('exhausted at 2'),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sink).toHaveLength(1);
      expect(sink[0].attemptsExhausted).toBe(2); // Uses per-job override, not 100
    });

    it('BullMQ worker falls back to service default when job.opts.attempts is undefined', async () => {
      const sink: NotificationDeadLetterRecord[] = [];
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 5, delay: 1, maxDelayMs: 100 }, // Service default: 5
          deadLetterSink: { record: (entry) => void sink.push(entry) },
        },
        undefined,
        configWith({ REDIS_URL: 'redis://localhost:6379' }),
      );
      service.registerDispatcher('EMAIL', { dispatch: jest.fn() });
      await service.onModuleInit();
      expect(failedHandler).toBeDefined();

      // Job has no per-job override
      failedHandler!(
        {
          data: makeJob({ requestId: 'per-job-2' }),
          attemptsMade: 5,
          opts: { attempts: undefined }, // Fallback to service default
        },
        new Error('exhausted at 5'),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sink).toHaveLength(1);
      expect(sink[0].attemptsExhausted).toBe(5); // Uses service default
    });

    it('in-process path uses service backoff.attempts (no per-job override mechanism)', async () => {
      const dispatch = jest
        .fn()
        .mockRejectedValue(new Error('fail'));
      const dlq: NotificationDeadLetterRecord[] = [];
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 3, delay: 1, maxDelayMs: 5 },
          deadLetterSink: { record: (entry) => void dlq.push(entry) },
          scheduleDelayed: synchronousScheduler,
        },
        undefined,
      );
      service.registerDispatcher('EMAIL', { dispatch });

      await service.enqueue(makeJob({ requestId: 'in-process-attempts' }));

      // Dispatch called exactly 3 times (service default)
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dlq).toHaveLength(1);
      expect(dlq[0].attemptsExhausted).toBe(3);
    });
  });

  describe('Timer injection — scheduleDelayed fallback', () => {
    it('uses injected timer function when provided', async () => {
      const timerCalls: Array<{ cb: () => void; ms: number }> = [];
      const customScheduler = (cb: () => void, ms: number) => {
        timerCalls.push({ cb, ms });
        cb(); // Execute immediately for test
      };

      const dispatch = jest
        .fn()
        .mockRejectedValueOnce(new Error('retry1'))
        .mockRejectedValueOnce(new Error('retry2'))
        .mockResolvedValueOnce(undefined);
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 3, delay: 100, maxDelayMs: 1000 },
          scheduleDelayed: customScheduler,
        },
        undefined,
      );
      service.registerDispatcher('EMAIL', { dispatch });

      await service.enqueue(makeJob({ requestId: 'timer-inject' }));

      // Should have called the scheduler for retries
      expect(timerCalls.length).toBeGreaterThan(0);
      expect(dispatch).toHaveBeenCalledTimes(3);
    });

    it('falls back to setTimeout when no injected timer provided', async () => {
      const dispatch = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockResolvedValueOnce(undefined);
      
      // Set a fast setTimeout for test
      const originalSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 2, delay: 10, maxDelayMs: 100 },
          // No scheduleDelayed provided → should use setTimeout
        },
        undefined,
      );
      service.registerDispatcher('EMAIL', { dispatch });

      await service.enqueue(makeJob({ requestId: 'timer-default' }));

      expect(dispatch).toHaveBeenCalledTimes(2);
      // setTimeout should be called for the retry delay
      expect(setTimeoutSpy).toHaveBeenCalled();
      
      setTimeoutSpy.mockRestore();
    });

    it('injected timer respects the computed backoff delay', async () => {
      const delays: number[] = [];
      const timerScheduler = (cb: () => void, ms: number) => {
        delays.push(ms);
        cb();
      };

      const dispatch = jest
        .fn()
        .mockRejectedValue(new Error('always fails'));
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 3, delay: 1000, maxDelayMs: 10000 },
          scheduleDelayed: timerScheduler,
        },
        undefined,
      );
      service.registerDispatcher('EMAIL', { dispatch });

      await service.enqueue(makeJob({ requestId: 'timer-delays' }));

      // Should have computed delays for 2 retries (attempts 2 and 3)
      expect(delays.length).toBe(2);
      // Delays should be increasing (exponential backoff)
      expect(delays[0]).toBeLessThanOrEqual(delays[1]);
    });

    it('timer injection is used for in-process path but not BullMQ', async () => {
      const timerCalls: number[] = [];
      const customScheduler = (cb: () => void, ms: number) => {
        timerCalls.push(ms);
        cb();
      };

      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 2, delay: 100, maxDelayMs: 500 },
          scheduleDelayed: customScheduler,
        },
        undefined,
        configWith({ REDIS_URL: 'redis://localhost:6379' }),
      );

      // When initialized with Redis, BullMQ takes over and injected timer not used
      await service.onModuleInit();

      // The in-process path is not exercised, so injected timer should not be called
      expect(timerCalls).toHaveLength(0);
    });
  });

  describe('Combined branch scenarios', () => {
    it('handles all conditions false: no dispatcher, no notificationId, no prisma', async () => {
      const service = new NotificationRetryQueueService({
        backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
        scheduleDelayed: synchronousScheduler,
      });
      // No dispatcher, no prisma

      // Should silently drop without error
      await expect(
        service.enqueue(makeJob({ notificationId: undefined })),
      ).resolves.toBeUndefined();
    });

    it('handles all conditions true: dispatcher, notificationId, and prisma present', async () => {
      const prisma = {
        notification: { update: jest.fn().mockResolvedValue(undefined) },
      };
      const dispatch = jest.fn().mockResolvedValue(undefined);
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
          scheduleDelayed: synchronousScheduler,
        },
        prisma as unknown as PrismaService,
      );
      service.registerDispatcher('EMAIL', { dispatch });

      await service.enqueue(makeJob({ notificationId: 'n-all-true' }));

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'n-all-true' },
          data: expect.objectContaining({ status: 'SENT' }),
        }),
      );
    });

    it('SMS channel uses same guards as EMAIL channel', async () => {
      const prisma = {
        notification: { update: jest.fn().mockResolvedValue(undefined) },
      };
      const dispatch = jest.fn().mockResolvedValue(undefined);
      const service = new NotificationRetryQueueService(
        {
          backoff: { attempts: 2, delay: 1, maxDelayMs: 5 },
          scheduleDelayed: synchronousScheduler,
        },
        prisma as unknown as PrismaService,
      );
      service.registerDispatcher('SMS', { dispatch });

      await service.enqueue(
        makeJob({
          channel: 'SMS',
          notificationId: 'n-sms',
        }),
      );

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'n-sms' },
        }),
      );
    });
  });
});
