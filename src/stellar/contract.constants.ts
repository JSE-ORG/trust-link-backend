/**
 * Stellar contract-service constants (issue #238). Replaces magic numbers
 * previously inlined in `contract.service.ts`.
 */

/**
 * Default number of retries for transactions that fail with a sequence-number
 * error before giving up (the initial attempt is not counted as a retry).
 */
export const DEFAULT_AUTO_RELEASE_MAX_RETRIES = 2;
