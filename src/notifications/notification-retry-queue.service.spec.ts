import { Logger } from '@nestjs/common';
import {
  NotificationChannelDispatcher,
  NotificationDeadLetterSink,
  NotificationRetryQueueService,
} from './notification-retry-queue.service';
import type {
  NotificationRetryJobData,
} from './notification-retry-queue.types';
import { NotificationRepository } from './notification.repository';
import { ConfigService } from '../config/config.service';

interface MockBullJob {
  data: NotificationRetryJobData;
  attemptsMade: number;
  opts: { attempts?: number };
}

type ProcessorFn = (job: MockBullJob) => Promise<void>;
type FailedHandlerFn = (job: MockBullJob | undefined, error: Error) => void;

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn();

let capturedProcessor: ProcessorFn | null = null;
let capturedFailedHandler: FailedHandlerFn | null = null;
let queueInstances: Array<{ name: string; add: jest.Mock; close: jest.Mock }> =
  [];
let throwOnConnect = false;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    if (throwOnConnect) {
      throw new Error('Redis connection refused');
    }
    const instance = {
      name,
      add: jest.fn((...args: unknown[]) => mockQueueAdd(name, ...args)),
      close: mockQueueClose,
    };
    queueInstances.push(instance);
    return instance;
  }),
  Worker: jest
    .fn()
    .mockImplementation((_name: string, processor: ProcessorFn) => {
      capturedProcessor = processor;
      return {
        on: mockWorkerOn.mockImplementation(
          (event: string, handler: FailedHandlerFn) => {
            if (event === 'failed') {
              capturedFailedHandler = handler;
            }
          },
        ),
        close: mockWorkerClose,
      };
    }),
}));

function makeJobData(
  overrides: Partial<NotificationRetryJobData> = {},
): NotificationRetryJobData {
  return {
    channel: 'EMAIL',
    type: 'FUNDED',
    recipientAddress: 'GBUYER001',
    notificationId: 'notif-1',
    requestId: 'req-1',
    escrow: {
      id: 'escrow-1',
      contractEscrowId: null,
      itemName: 'Laptop',
      itemRef: 'REF-1',
      amount: 500,
      currency: 'USDC',
      buyerAddress: 'GBUYER001',
      vendorAddress: 'GVENDOR001',
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
    },
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('NotificationRetryQueueService (BullMQ / Redis worker path)', () => {
  let notifications: jest.Mocked<
    Pick<
      NotificationRepository,
      'markSent' | 'markAttemptFailed' | 'markFailed'
    >
  >;
  let configService: { get: jest.Mock };
  let deadLetterSink: jest.Mocked<NotificationDeadLetterSink>;
  let service: NotificationRetryQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = null;
    capturedFailedHandler = null;
    queueInstances = [];
    throwOnConnect = false;

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    notifications = {
      markSent: jest.fn().mockResolvedValue(undefined),
      markAttemptFailed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string) =>
        key === 'REDIS_URL' ? 'redis://localhost:6379' : undefined,
      ),
    };
    deadLetterSink = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new NotificationRetryQueueService(
      {
        backoff: { attempts: 3, delay: 100 },
        deadLetterSink,
      },
      notifications as unknown as NotificationRepository,
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects BullMQ on init, enqueues, and closes on destroy', async () => {
    await service.onModuleInit();

    expect(queueInstances.map((q) => q.name)).toEqual([
      'notifications-retry',
      'notifications-dlq',
    ]);
    expect(capturedProcessor).toBeInstanceOf(Function);
    expect(capturedFailedHandler).toBeInstanceOf(Function);

    const jobData = makeJobData();
    await service.enqueue(jobData);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'notifications-retry',
      'EMAIL-FUNDED',
      expect.objectContaining({
        channel: 'EMAIL',
        type: 'FUNDED',
        notificationId: 'notif-1',
      }),
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 100 },
      }),
    );

    await service.onModuleDestroy();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(2);
  });

  it('falls back cleanly when BullMQ init fails', async () => {
    throwOnConnect = true;

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Failed to connect BullMQ; falling back to in-process retry',
      expect.any(Error),
    );
  });

  describe('worker processor', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('throws when no dispatcher is registered', async () => {
      const job: MockBullJob = {
        data: makeJobData({ channel: 'SMS' }),
        attemptsMade: 0,
        opts: { attempts: 3 },
      };

      await expect(capturedProcessor!(job)).rejects.toThrow(
        'No dispatcher registered for channel SMS',
      );
    });

    it('dispatches the job and marks notification as SENT', async () => {
      const dispatcher: jest.Mocked<NotificationChannelDispatcher> = {
        dispatch: jest.fn().mockResolvedValue(undefined),
      };
      service.registerDispatcher('EMAIL', dispatcher);

      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 1,
        opts: { attempts: 3 },
      };

      await capturedProcessor!(job);

      expect(dispatcher.dispatch).toHaveBeenCalledWith(job.data);
      expect(notifications.markSent).toHaveBeenCalledWith('notif-1', 1);
    });

    it('logs and does not fail the job when markSent rejects', async () => {
      const dispatcher: jest.Mocked<NotificationChannelDispatcher> = {
        dispatch: jest.fn().mockResolvedValue(undefined),
      };
      service.registerDispatcher('EMAIL', dispatcher);
      notifications.markSent.mockRejectedValueOnce(new Error('DB down'));

      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 0,
        opts: { attempts: 3 },
      };

      await expect(capturedProcessor!(job)).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to update notification status to SENT in worker',
        expect.any(Error),
      );
    });

    it('marks attempt failed and rethrows on dispatch error', async () => {
      const dispatchErr = new Error('SendGrid 503');
      const dispatcher: jest.Mocked<NotificationChannelDispatcher> = {
        dispatch: jest.fn().mockRejectedValue(dispatchErr),
      };
      service.registerDispatcher('EMAIL', dispatcher);

      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 1,
        opts: { attempts: 3 },
      };

      await expect(capturedProcessor!(job)).rejects.toThrow('SendGrid 503');
      expect(notifications.markAttemptFailed).toHaveBeenCalledWith(
        'notif-1',
        2,
        'SendGrid 503',
      );
    });

    it('handles non-Error rejections and markAttemptFailed errors', async () => {
      const dispatcher: jest.Mocked<NotificationChannelDispatcher> = {
        dispatch: jest.fn().mockRejectedValue('transient timeout'),
      };
      service.registerDispatcher('EMAIL', dispatcher);
      notifications.markAttemptFailed.mockRejectedValueOnce(
        new Error('DB write failed'),
      );

      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 0,
        opts: { attempts: 3 },
      };

      await expect(capturedProcessor!(job)).rejects.toBe('transient timeout');
      expect(notifications.markAttemptFailed).toHaveBeenCalledWith(
        'notif-1',
        1,
        'transient timeout',
      );
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to update notification status on error in worker',
        expect.any(Error),
      );
    });
  });

  describe('failed listener', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('ignores undefined jobs', async () => {
      capturedFailedHandler!(undefined, new Error('orphan failure'));
      await flushMicrotasks();

      expect(notifications.markFailed).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(deadLetterSink.record).not.toHaveBeenCalled();
    });

    it('skips markFailed and DLQ while retries remain', async () => {
      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 2,
        opts: { attempts: 3 },
      };

      capturedFailedHandler!(job, new Error('still retrying'));
      await flushMicrotasks();

      expect(notifications.markFailed).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
      expect(deadLetterSink.record).not.toHaveBeenCalled();
    });

    it('marks FAILED and moves job to DLQ when exhausted', async () => {
      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 3,
        opts: { attempts: 3 },
      };

      capturedFailedHandler!(job, new Error('permanent failure'));
      await flushMicrotasks();

      expect(notifications.markFailed).toHaveBeenCalledWith('notif-1');
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'notifications-dlq',
        'EMAIL-FUNDED-dlq',
        expect.objectContaining({
          channel: 'EMAIL',
          type: 'FUNDED',
          escrowId: 'escrow-1',
          attemptsExhausted: 3,
          lastError: 'permanent failure',
        }),
        expect.objectContaining({
          removeOnComplete: false,
          removeOnFail: false,
        }),
      );
      expect(deadLetterSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          escrowId: 'escrow-1',
          attemptsExhausted: 3,
          lastError: 'permanent failure',
        }),
      );
    });

    it('uses backoff.attempts fallback and logs markFailed error', async () => {
      notifications.markFailed.mockRejectedValueOnce(new Error('DB offline'));
      const job: MockBullJob = {
        data: makeJobData(),
        attemptsMade: 3,
        opts: {},
      };

      capturedFailedHandler!(job, new Error('exhausted'));
      await flushMicrotasks();

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to update notification status to FAILED in worker',
        expect.any(Error),
      );
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'notifications-dlq',
        'EMAIL-FUNDED-dlq',
        expect.objectContaining({
          attemptsExhausted: 3,
          lastError: 'exhausted',
        }),
        expect.any(Object),
      );
    });
  });
});
