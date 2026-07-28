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

/** Milliseconds in one hour. */
export const MILLISECONDS_PER_HOUR = SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND;

/** Milliseconds in one day. */
export const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * MILLISECONDS_PER_SECOND;
