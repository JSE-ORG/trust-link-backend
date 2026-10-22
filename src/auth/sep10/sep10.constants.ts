import { SECONDS_PER_DAY } from '../../common/constants/time.constants';

/**
 * SEP-10 authentication constants (issue #238). Replaces magic numbers
 * previously inlined in `sep10.service.ts`.
 */

/** Lifetime of a SEP-10 challenge transaction, in seconds (5 minutes). */
export const CHALLENGE_TIMEOUT_SECONDS = 5 * 60;

/** Default refresh-token TTL when `REFRESH_TOKEN_TTL` is unset, in seconds (7 days). */
export const REFRESH_TOKEN_TTL_DEFAULT = 7 * SECONDS_PER_DAY;
