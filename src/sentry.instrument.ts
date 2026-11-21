import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

/**
 * #1175 — The environment-specific defaults are unchanged (0.2 in production,
 * 1.0 elsewhere). An operator-supplied SENTRY_TRACES_SAMPLE_RATE overrides
 * them. Config validation rejects out-of-range values at boot; the guard here
 * only keeps a malformed value from reaching Sentry before that happens.
 */
function resolveTracesSampleRate(): number {
  const fallback = process.env.NODE_ENV === 'production' ? 0.2 : 1.0;
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.GIT_SHA,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: resolveTracesSampleRate(),
    skipOpenTelemetrySetup: true,
  });
}
