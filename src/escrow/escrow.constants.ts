/**
 * Escrow-module constants (issue #238). Centralises magic numbers previously
 * inlined in `escrow.repository.ts` and `auto-release.service.ts`.
 */

/** Redis cache TTL for a single escrow record, in seconds. */
export const ESCROW_CACHE_TTL_SECONDS = 60;

/**
 * Number of days after delivery before an escrow qualifies for auto-release.
 * The auto-release service computes the cutoff as `now - AUTO_RELEASE_DAYS`.
 */
export const AUTO_RELEASE_DAYS = 7;
