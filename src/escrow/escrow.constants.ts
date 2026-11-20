/**
 * Escrow-module constants (issue #238). Centralises magic numbers previously
 * inlined in `escrow.repository.ts`.
 */

/**
 * Default and maximum cache TTL for a single escrow record, in seconds.
 * `ESCROW_CACHE_TTL_SECONDS` in the environment can lower it.
 */
export const ESCROW_CACHE_TTL_SECONDS = 60;

/**
 * Hours after delivery before an escrow qualifies for auto-release.
 * `EscrowRepository.findAutoReleaseEligible` computes the cutoff as
 * `referenceTime - AUTO_RELEASE_WINDOW_HOURS`.
 */
export const AUTO_RELEASE_WINDOW_HOURS = 48;

/** Maximum rows returned by `GET /vendor/escrows/export`. */
export const ESCROW_EXPORT_MAX_ROWS = 10_000;
