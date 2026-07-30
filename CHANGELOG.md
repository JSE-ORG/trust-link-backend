# Changelog

All notable changes to Trust-Link Backend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Additional escrow and dispute lifecycle states for creation, cancellation, review, resolution, and abandonment.
- Production Docker Compose profile with service health checks, restart policies, resource limits, and log rotation.
- Optional `SEP10_SIGNING_SECRET` configuration for a dedicated, stable SEP-10 web-auth signing key.
- Database commands for safely applying migrations, resetting a local database, and idempotently seeding development data.
- Persistent notification delivery status and retry information.

### Changed

- `GiglClient` now rejects 2xx responses whose body does not match the expected `GiglTrackingResponse` schema, surfacing them as `GiglInvalidResponseError` instead of leaking bad payloads downstream. The new behaviour is exercised by the unit-test suite added alongside this change.

### Changed

- Escrow listings for vendors and buyers are cursor-paginated, return newest records first, and default to 20 records per page.
- Creating an escrow requires an `Idempotency-Key`; keys must be UUIDs and are scoped to the authenticated vendor.
- SEP-10 challenge signing now uses a configured key that remains stable across restarts and replicas.

### Fixed

- Auto-release transactions reload the Stellar account sequence before retrying and use an atomic claim to prevent duplicate submissions.
- Dispute creation invalidates the related escrow cache, and administrative dispute resolution records the dispute as resolved.
- Configured SendGrid and Twilio notification clients are now used when their credentials are available.
- Auto-release processing continues with other eligible escrows when an individual submission fails.

### Removed

- Support for using a raw Stellar address as a bearer token; API clients must send a valid, signed, unexpired SEP-10 JWT.

### Security

- Stress-test endpoints now require authenticated administrator access.
- Escrow contact details are rejected unless encrypted before persistence, and logistics API credentials are encrypted at rest.
- JWT validation fails closed when its signing secret is missing, malformed, expired, or has an invalid signature.

---

## [1.1.0] - 2026-06-27

### Added

- OpenTelemetry distributed tracing with OTLP export, database spans, and workflow-level context propagation ([#79](https://github.com/JSE-ORG/trust-link-backend/issues/79))
- Security policy with vulnerability disclosure procedures ([#90](https://github.com/JSE-ORG/trust-link-backend/issues/90))
- Incident response runbook for backup restoration and container recovery ([#97](https://github.com/JSE-ORG/trust-link-backend/issues/97))
- Jaeger all-in-one service in Docker Compose for local trace visualization
- `HorizonService` for direct Stellar Horizon API interactions (#341)
- Vendor profile CRUD endpoints with notification preference management (#341)
- Vendor analytics chart data endpoint (#341)
- Database-backed cursor persistence for event replay worker (#339)
- Persistent Dead-Letter Queue (DLQ) with retry and purge admin endpoints (#339)
- Real BullMQ dashboard at `/admin/queue` (#339)
- Integration tests for auto-release collision detection and webhook HMAC verification (#352)
- E2E tests for auto-release, DLQ, escrow cancellation, and dispute resolution (#340)
- Concurrent auto-release collision detection tests (#348)
- Unit tests for `AdminGuard`, `CacheService`, `GlobalExceptionFilter`, and `VendorProfileService` (#346)
- Throttler/rate-limit unit tests (#344)
- Bootstrap error handling and graceful `SIGTERM`/`SIGINT` shutdown (#355)
- Nonce cleanup service to prune expired SEP-10 challenges (#359)
- Enhanced health check endpoint with per-dependency error details (#359)
- Cross-vendor access control enforcement on escrow endpoints (#359)
- `CREATED` and `DISPUTED` states added to `VendorEscrowsQueryDto` filter (#250)

### Changed

- `GET /health` and `GET /version` now report the semver from `package.json`
- `findAutoReleaseEligible` no longer double-subtracts time — the caller (`AutoReleaseService`) owns the 7-day cutoff calculation (#249)
- `NODE_ENV` in default `.env` changed from `test` to `development` so workers and rate limits initialise correctly during local development (#248)
- Strict Content-Security-Policy extended to allow required Stellar origin headers (#334)
- Dead code removed and log noise reduced across services (#354)

### Fixed

- JWT secret minimum-length validation now enforced at startup
- `AdminGuard` correctly rejects non-admin Stellar addresses
- Stellar webhook HMAC signature verification hardened
- `crypto` import corrected to use Node's built-in `node:crypto` module
- Error handling improved across auto-release, tracking, and notification flows

### Security

- Auth and webhook security headers hardened (#333)
- Strict CSP blocks non-Stellar origins in production (#334)

---

## [1.0.0] - 2026-05-29

First stable release of the Trust-Link escrow backend.

### Added

- NestJS 11 application with escrow lifecycle management (`POST/GET/PATCH /escrow`)
- SEP-10 Stellar authentication with JWT challenge/verify flow
- Vendor profile management (`/vendor/profile`, vendor escrow listings)
- Buyer dispute flow with evidence URLs
- Stellar Horizon webhook receiver with HMAC verification and idempotent event processing
- Admin modules: statistics, dispute resolution, API key rotation, BullMQ-style queue dashboard
- Structured JSON logging with configurable `LOG_LEVEL` ([#81](https://github.com/truestlink/trust-link-backend/issues/81))
- CORS configuration via `ALLOWED_ORIGINS` ([#85](https://github.com/truestlink/trust-link-backend/issues/85))
- Rate limiting guard on sensitive endpoints
- Security headers middleware
- Redis response caching with graceful no-op fallback ([#103](https://github.com/truestlink/trust-link-backend/issues/103))
- PostgreSQL schema via Prisma with migrations (escrow, disputes, vendor profiles, webhook cursor)
- Docker multi-stage production image with non-root user and health check
- Docker Compose stack (app, PostgreSQL 15, Redis 7)
- Auto-release worker with optimistic DB locking and exponential-backoff notifications
- Tracking poll worker for shipment status updates
- Multi-currency Stellar asset configuration (including cNGN stablecoin)
- Event replay service for Stellar contract events
- In-process audit log for admin actions ([#94](https://github.com/truestlink/trust-link-backend/issues/94))
- Optional SendGrid email and Twilio SMS notifications
- Stress-test module and CLI runner
- CI workflows: unit tests with coverage threshold, ESLint on PRs
- Architecture documentation (`ARCHITECTURE.md`)
- Environment variable reference (`.env.example`)

### Fixed

- Regenerated `package-lock.json` to resolve missing `@nestjs/axios` dependency entries
- Idempotent auto-release via optimistic lock to prevent duplicate fund releases

### Security

- JWT secret minimum length enforcement (32 characters) via Joi validation
- Webhook signature verification when `STELLAR_WEBHOOK_SECRET` is configured
- Production CORS blocks all origins when `ALLOWED_ORIGINS` is unset

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| **1.1.0** | 2026-06-27 | Tracing, persistent DLQ, BullMQ dashboard, HorizonService, vendor analytics, bug fixes |
| **1.0.0** | 2026-05-29 | Initial stable release — escrow, SEP-10 auth, webhooks, admin, Docker |

### Semantic Versioning Guide

| Bump | When |
|------|------|
| **MAJOR** (X.0.0) | Breaking API or database schema changes |
| **MINOR** (1.X.0) | New features, backward-compatible |
| **PATCH** (1.0.X) | Bug fixes and security patches |

[Unreleased]: https://github.com/JSE-ORG/trust-link-backend/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/JSE-ORG/trust-link-backend/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/JSE-ORG/trust-link-backend/releases/tag/v1.0.0
