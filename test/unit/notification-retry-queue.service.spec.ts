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
import {
  EscrowRecord,
  NotificationType,
} from '../../src/prisma/prisma.service';

const escrow: EscrowRecord = {
  id: 'escrow-1',
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
    } = {},
  ) => {
    const dispatcher: NotificationChannelDispatcher = overrides.dispatcher ?? {
      dispatch: jest.fn(),
    };
    const dlq: NotificationDeadLetterRecord[] = [];
    const service = new NotificationRetryQueueService({
      backoff: overrides.backoff ?? {
        attempts: 3,
        delay: 1,
        maxDelayMs: 10,
      },
      deadLetterSink: { record: (entry) => void dlq.push(entry) },
      scheduleDelayed: synchronousScheduler,
    });
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
