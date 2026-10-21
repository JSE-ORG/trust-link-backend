/**
 * Escrow-module constants (issue #238). Centralises magic numbers previously
 * inlined in `escrow.repository.ts`.
 */

/** Redis cache TTL for a single escrow record, in seconds. */
export const ESCROW_CACHE_TTL_SECONDS = 60;

/**
 * Hours after delivery before an escrow qualifies for auto-release.
 * `EscrowRepository.findAutoReleaseEligible` computes the cutoff as
 * `referenceTime - AUTO_RELEASE_WINDOW_HOURS`.
 */
export const AUTO_RELEASE_WINDOW_HOURS = 48;
