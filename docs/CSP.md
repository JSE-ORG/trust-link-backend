# Content Security Policy (CSP)

The CSP `connect-src` directive is built dynamically by
`buildCspConnectSrc()` in `src/common/security/csp.config.ts` and applied via
Helmet.

## Configured origins

`connect-src` is assembled from the following sources:

- **Stellar Horizon URL** — derived from configuration or the network default
  (testnet / mainnet).
- **Sentry DSN origin** — included only when `SENTRY_DSN` is configured.
- **OpenTelemetry exporter origin** — included only when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is configured.
- **Logistics API origin** — included only when
  `LOGISTICS_API_BASE_URL` is configured.
- **Extra development origins** — from the `CSP_CONNECT_SRC` environment
  variable (comma-separated).

Redis, SendGrid, and Twilio are server-side integrations, so they are **not**
added to browser `connect-src` unless explicitly listed in
`CSP_CONNECT_SRC` for development.

## Acceptance criteria

- Horizon origin is derived from configuration or network default.
- Observability (Sentry, OTEL) and logistics origins are included only when
  configured.
- Extra development origins come from `CSP_CONNECT_SRC`.
- Unit tests in `csp.config.spec.ts` verify the exact allowed origins.
