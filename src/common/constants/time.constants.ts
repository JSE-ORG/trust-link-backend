/**
 * Shared time-unit constants used across the codebase to replace inline magic
 * numbers (issue #238). Centralising these keeps duration arithmetic readable
 * and consistent (e.g. `AUTO_RELEASE_DAYS * MILLISECONDS_PER_DAY`).
 */

/** Milliseconds in one second. */
export const MILLISECONDS_PER_SECOND = 1000;

/** Seconds in one minute. */
export const SECONDS_PER_MINUTE = 60;

/** Minutes in one hour. */
export const MINUTES_PER_HOUR = 60;

/** Hours in one day. */
export const HOURS_PER_DAY = 24;

/** Seconds in one hour (3600). */
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

/** Seconds in one day (86 400). */
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;

/** Milliseconds in one minute. */
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

/** Milliseconds in one hour. */
export const MILLISECONDS_PER_HOUR = SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND;

/** Five minutes in milliseconds. */
export const FIVE_MINUTES_MS = 5 * MILLISECONDS_PER_MINUTE;

/** Ten minutes in milliseconds. */
export const TEN_MINUTES_MS = 10 * MILLISECONDS_PER_MINUTE;

/** One hour in seconds, for API TTLs expressed in seconds. */
export const ONE_HOUR_SECONDS = SECONDS_PER_HOUR;

/** One year in seconds. */
export const ONE_YEAR_SECONDS = 365 * SECONDS_PER_DAY;
