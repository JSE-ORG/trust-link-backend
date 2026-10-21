/**
 * Stellar contract-service constants (issue #238). Replaces magic numbers
 * previously inlined in `contract.service.ts`.
 */

/**
 * Default number of retries for transactions that fail with a sequence-number
 * error before giving up (the initial attempt is not counted as a retry).
 */
export const DEFAULT_AUTO_RELEASE_MAX_RETRIES = 2;

/**
 * How long the `getTransaction` confirmation path waits for a transaction to
 * leave NOT_FOUND/PENDING before giving up (issue #921), in milliseconds.
 */
export const TX_CONFIRM_TIMEOUT_MS = 30_000;

/** Delay between `getTransaction` confirmation polls (issue #921), in ms. */
export const TX_CONFIRM_POLL_INTERVAL_MS = 250;
