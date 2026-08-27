/**
 * Throttle limits that a route-level `@Throttle()` needs.
 *
 * Decorators are evaluated at module load, before the Nest container exists,
 * so they cannot read ConfigService. They read `process.env` here instead,
 * which is the same source ConfigService validates — `ConfigModule` runs with
 * `ignoreEnvFile: true`, so the process environment is the only input either
 * path sees. In tests the values come from `.env.test`, loaded by the jest
 * `setupFiles` hook before any import.
 *
 * Why these are not named throttlers in `ThrottlerModule.forRootAsync`:
 * @nestjs/throttler resolves a route-level override by *name* against the
 * list declared there, and an undeclared name is silently ignored rather than
 * raising — the route then quietly falls back to the default limit. Declaring
 * the name instead is not a fix either, because the guard evaluates every
 * declared throttler on every handler, so the upload limit would apply to the
 * whole API. Overriding `default` on the one route keeps it local.
 */

const toPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The rolling window every route-level `@Throttle()` counts requests over,
 * in **milliseconds** (60_000 = one minute). Defined once here instead of
 * repeating `ttl: 60000` inline at every decorator (#667): each site only
 * varies its `limit`, so changing the window used to mean editing ~30 call
 * sites and hoping none were missed. Per-route limits are unchanged.
 */
export const THROTTLE_WINDOW_MS = 60_000;

export const EVIDENCE_UPLOAD_THROTTLE = {
  ttl: toPositiveInt(process.env.EVIDENCE_UPLOAD_TTL, 60_000),
  limit: toPositiveInt(process.env.EVIDENCE_UPLOAD_LIMIT, 10),
};
