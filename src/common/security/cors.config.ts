/**
 * Request headers the API reads via `@Headers(...)` in a controller that a
 * browser client (on an allowed CORS origin) may need to call.
 *
 * Keep this in step with the controllers: a header missing here means the
 * preflight response won't advertise it, so the browser blocks the actual
 * request before it is sent — exactly what happened with `Idempotency-Key`
 * on `POST /escrow` (issue #497).
 */
export const CORS_ALLOWED_HEADERS = [
  'Origin',
  'X-Requested-With',
  'Content-Type',
  'Accept',
  'Authorization',
  'Idempotency-Key',
  'X-Request-ID',
];

/**
 * Response headers the API sets that a browser script is allowed to read.
 *
 * By default the CORS spec only exposes a small set of "safe" headers
 * (Content-Type, Cache-Control, etc.). Any custom header the front-end needs
 * to read — like the request-correlation id — must be listed here or the
 * browser silently blocks access to it (issue #973).
 */
export const CORS_EXPOSED_HEADERS = ['X-Request-ID'];
