/**
 * Shared types for the notification retry queue (#73).
 *
 * Split from `notification-retry-queue.service.ts` so other modules
 * (workers, controllers, tests) can import the contract without
 * pulling in the BullMQ runtime.
 */

import type { NotificationType, EscrowRecord } from '../prisma/prisma.service';

export type NotificationChannel = 'EMAIL' | 'SMS';

/**
 * Job payload enqueued on the retry queue. The processor consumes
 * this and calls the same SendGrid / Twilio dispatcher the
 * synchronous path uses today.
 */
export interface NotificationRetryJobData {
    channel: NotificationChannel;
    type: NotificationType;
    escrow: EscrowRecord;
    recipientAddress: string;
    /** Optional correlation id so cross-service log lines stitch together. */
    requestId?: string;
}

/**
 * Backoff configuration applied to enqueued jobs. Matches BullMQ's
 * exponential-backoff shape — `delay` is the initial delay; each
 * subsequent attempt waits 2^(n-1) * delay ms.
 *
 *  attempt 1 → delay
 *  attempt 2 → delay * 2
 *  attempt 3 → delay * 4  ...
 *
 * `attempts` is the **total** number of dispatch attempts (including
 * the first), so `attempts: 5` means 1 immediate + 4 retries.
 */
export interface NotificationRetryBackoff {
    attempts: number;
    /** Initial delay in ms. */
    delay: number;
    /** Optional cap so a high attempt count doesn't push the delay
     *  past a sensible ceiling (default 5 minutes). */
    maxDelayMs?: number;
}

export const DEFAULT_BACKOFF: NotificationRetryBackoff = {
    attempts: 5,
    delay: 1_000,
    maxDelayMs: 5 * 60 * 1_000,
};

/**
 * Pure helper: compute the delay for a given attempt number. Used by
 * both the BullMQ wiring (via `backoff.delay`) and the in-process
 * fallback. Exported for tests.
 *
 * `attemptNumber` is 1-indexed (the first retry after the initial
 * dispatch is attempt 2, etc.).
 */
export const computeBackoffDelay = (
    attemptNumber: number,
    backoff: NotificationRetryBackoff = DEFAULT_BACKOFF,
): number => {
    if (attemptNumber <= 1) return 0;
    const raw = backoff.delay * Math.pow(2, attemptNumber - 2);
    return Math.min(raw, backoff.maxDelayMs ?? Number.POSITIVE_INFINITY);
};

/**
 * Dead-letter record stored when a job has exhausted all retries.
 * The shape mirrors `Notification.failureReason` so the existing
 * Prisma surface can persist it directly.
 */
export interface NotificationDeadLetterRecord {
    channel: NotificationChannel;
    type: NotificationType;
    escrowId: string;
    recipientAddress: string;
    attemptsExhausted: number;
    lastError: string;
    failedAt: Date;
    requestId?: string;
}
