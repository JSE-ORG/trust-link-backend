# CSP connection audit

Configured browser connection origins are built from:

- Stellar Horizon URL or the network default.
- Sentry DSN origin when configured.
- OpenTelemetry exporter origin when configured.
- Logistics API origin when configured.
- Extra development origins from `CSP_CONNECT_SRC`.

Redis, SendGrid, and Twilio are server-side integrations, so they are not added to browser `connect-src` unless explicitly configured for development.
