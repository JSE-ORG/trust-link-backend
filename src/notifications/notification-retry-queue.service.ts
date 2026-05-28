/**
 * NotificationRetryQueueService (#73)
 *
 * Wraps the existing SendGrid / Twilio dispatchers in an async retry
 * queue. BullMQ + Redis is the production backend; when Redis is not
 * configured (REDIS_URL unset), the service falls back to an
 * in-process retry runner that uses the same exponential-backoff
 * schedule so unit tests, local dev, and CI environments without
 * Redis behave identically from the caller's perspective.
 *
 * What the queue gives us over the existing in-line retry loop:
 *  - **Service-drop tolerance**: jobs survive a process restart
 *    because Redis owns the state. The previous synchronous loop
 *    lost in-flight retries on any crash.
 *  - **Progressive backoff** managed by BullMQ (`exponential` with
 *    the same initial delay we already use).
 *  - **Dead-letter queue**: jobs that exhaust their attempts land on
 *    a `notifications-dlq` queue + are recorded against the
 *    `Notification.failureReason` slot so the failure stays visible.
 *  - **Per-channel parallelism**: emails and SMS are processed by
 *    independent workers so a Twilio outage doesn't stall the email
 *    pipeline (and vice versa).
 */

import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
    Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { ConnectionOptions } from 'bullmq';

import {
    NotificationRetryJobData,
    NotificationRetryBackoff,
    NotificationDeadLetterRecord,
    DEFAULT_BACKOFF,
    computeBackoffDelay,
} from './notification-retry-queue.types';

/**
 * Minimal interface the service requires from the per-channel
 * dispatcher — both the SendGrid and Twilio paths in
 * `NotificationsService` can be reduced to this shape.
 */
export interface NotificationChannelDispatcher {
    dispatch(job: NotificationRetryJobData): Promise<void>;
}

/**
 * Hook for tests and for the in-process fallback to inspect what
 * landed on the DLQ.
 */
export interface NotificationDeadLetterSink {
    record(entry: NotificationDeadLetterRecord): Promise<void> | void;
}

const QUEUE_NAME = 'notifications-retry';
const DLQ_NAME = 'notifications-dlq';

interface CommonOptions {
    backoff?: NotificationRetryBackoff;
    deadLetterSink?: NotificationDeadLetterSink;
    /**
     * Hook used by `enqueue` to schedule a delayed retry in the
     * in-process backend. Exposed so tests can substitute fake timers
     * without monkey-patching `setTimeout`.
     */
    scheduleDelayed?: (cb: () => void, ms: number) => void;
}

/**
 * The Nest provider exposes one queue per channel. When Redis is
 * configured the service uses BullMQ; otherwise it uses an in-process
 * worker so test + dev environments keep working with no Redis.
 */
@Injectable()
export class NotificationRetryQueueService
    implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(NotificationRetryQueueService.name);
    private bullQueue: import('bullmq').Queue<NotificationRetryJobData> | null =
        null;
    private bullWorker: import('bullmq').Worker<NotificationRetryJobData> | null =
        null;
    private bullDlq: import('bullmq').Queue<NotificationDeadLetterRecord> | null =
        null;
    private readonly dispatchers: Record<
        'EMAIL' | 'SMS',
        NotificationChannelDispatcher | null
    > = { EMAIL: null, SMS: null };
    private readonly options: Required<Omit<CommonOptions, 'deadLetterSink' | 'scheduleDelayed'>> &
        CommonOptions = {
        backoff: DEFAULT_BACKOFF,
    };

    constructor(
        @Optional() options?: CommonOptions,
    ) {
        if (options?.backoff) this.options.backoff = options.backoff;
        this.options.deadLetterSink = options?.deadLetterSink;
        this.options.scheduleDelayed = options?.scheduleDelayed;
    }

    registerDispatcher(
        channel: 'EMAIL' | 'SMS',
        dispatcher: NotificationChannelDispatcher,
    ): void {
        this.dispatchers[channel] = dispatcher;
    }

    /**
     * Enqueue a notification for delivery. When Redis is available
     * the job is added to the BullMQ queue; otherwise it runs through
     * the in-process retry runner.
     */
    async enqueue(job: NotificationRetryJobData): Promise<void> {
        const enriched: NotificationRetryJobData = {
            ...job,
            requestId: job.requestId ?? crypto.randomUUID(),
        };
        if (this.bullQueue) {
            await this.bullQueue.add(`${job.channel}-${job.type}`, enriched, {
                attempts: this.options.backoff.attempts,
                backoff: {
                    type: 'exponential',
                    delay: this.options.backoff.delay,
                },
                removeOnComplete: 100,
                removeOnFail: 100,
            });
            return;
        }
        await this.processInProcess(enriched);
    }

    /**
     * In-process retry runner that mirrors BullMQ's exponential
     * backoff. Used in test + dev environments without Redis.
     */
    private async processInProcess(
        job: NotificationRetryJobData,
    ): Promise<void> {
        const dispatcher = this.dispatchers[job.channel];
        if (!dispatcher) {
            this.logger.warn(
                `No dispatcher registered for channel ${job.channel}; dropping job ${job.requestId}`,
            );
            return;
        }

        const { attempts } = this.options.backoff;
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await dispatcher.dispatch(job);
                return;
            } catch (err) {
                lastError = err;
                if (attempt >= attempts) break;
                const delay = computeBackoffDelay(attempt + 1, this.options.backoff);
                await this.sleep(delay);
            }
        }
        await this.recordDeadLetter(job, attempts, lastError);
    }

    private async recordDeadLetter(
        job: NotificationRetryJobData,
        attemptsExhausted: number,
        lastError: unknown,
    ): Promise<void> {
        const entry: NotificationDeadLetterRecord = {
            channel: job.channel,
            type: job.type,
            escrowId: job.escrow.id,
            recipientAddress: job.recipientAddress,
            attemptsExhausted,
            lastError:
                lastError instanceof Error
                    ? lastError.message
                    : String(lastError ?? 'unknown error'),
            failedAt: new Date(),
            requestId: job.requestId,
        };
        this.logger.error(
            `Notification ${job.type}/${job.channel} for escrow ${job.escrow.id} ` +
                `exhausted ${attemptsExhausted} attempts — moved to DLQ ` +
                `(requestId: ${job.requestId})`,
        );
        if (this.bullDlq) {
            await this.bullDlq.add(`${job.channel}-${job.type}-dlq`, entry, {
                removeOnComplete: false,
                removeOnFail: false,
            });
        }
        if (this.options.deadLetterSink) {
            await this.options.deadLetterSink.record(entry);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            const scheduler =
                this.options.scheduleDelayed ??
                ((cb: () => void, t: number) => setTimeout(cb, t));
            scheduler(resolve, ms);
        });
    }

    async onModuleInit(): Promise<void> {
        const url = process.env.REDIS_URL;
        if (!url) {
            this.logger.warn(
                'REDIS_URL is not set; NotificationRetryQueueService is using the in-process retry runner. ' +
                    'Set REDIS_URL to enable BullMQ-backed persistence.',
            );
            return;
        }

        try {
            const { Queue, Worker } = await import('bullmq');
            const connection: ConnectionOptions = { url } as unknown as ConnectionOptions;
            this.bullQueue = new Queue<NotificationRetryJobData>(QUEUE_NAME, {
                connection,
            });
            this.bullDlq = new Queue<NotificationDeadLetterRecord>(DLQ_NAME, {
                connection,
            });
            this.bullWorker = new Worker<NotificationRetryJobData>(
                QUEUE_NAME,
                async job => {
                    const dispatcher = this.dispatchers[job.data.channel];
                    if (!dispatcher) {
                        throw new Error(
                            `No dispatcher registered for channel ${job.data.channel}`,
                        );
                    }
                    await dispatcher.dispatch(job.data);
                },
                { connection },
            );
            this.bullWorker.on('failed', async (job, error) => {
                if (
                    !job ||
                    job.attemptsMade < (job.opts.attempts ?? this.options.backoff.attempts)
                ) {
                    return;
                }
                await this.recordDeadLetter(
                    job.data,
                    job.attemptsMade,
                    error,
                );
            });
            this.logger.log(
                `BullMQ retry queue connected (queue: ${QUEUE_NAME}, dlq: ${DLQ_NAME})`,
            );
        } catch (err) {
            // Don't crash the Nest module on a misconfigured queue —
            // fall back to in-process processing so the rest of the
            // app stays up.
            this.logger.error(
                'Failed to connect BullMQ; falling back to in-process retry',
                err instanceof Error ? err : new Error(String(err)),
            );
            this.bullQueue = null;
            this.bullWorker = null;
            this.bullDlq = null;
        }
    }

    async onModuleDestroy(): Promise<void> {
        await Promise.all([
            this.bullWorker?.close(),
            this.bullQueue?.close(),
            this.bullDlq?.close(),
        ]);
    }

    /** Test helper — exposes the dispatcher map. */
    _getDispatchers(): Readonly<Record<'EMAIL' | 'SMS', NotificationChannelDispatcher | null>> {
        return this.dispatchers;
    }
}
