# Changelog

All notable changes to Trust-Link Backend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- OpenTelemetry distributed tracing with OTLP export, database spans, and workflow-level context propagation ([#79](https://github.com/truestlink/trust-link-backend/issues/79))
- Security policy with vulnerability disclosure procedures ([#90](https://github.com/truestlink/trust-link-backend/issues/90))
- Incident response runbook for backup restoration and container recovery ([#97](https://github.com/truestlink/trust-link-backend/issues/97))
- Jaeger all-in-one service in Docker Compose for local trace visualization

### Changed

- `GET /health` and `GET /version` now report the semver from `package.json`

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
| **1.0.0** | 2026-05-29 | Initial stable release — escrow, SEP-10 auth, webhooks, admin, Docker |
| **Unreleased** | — | Distributed tracing, security policy, incident runbook |

### Semantic Versioning Guide

| Bump | When |
|------|------|
| **MAJOR** (X.0.0) | Breaking API or database schema changes |
| **MINOR** (1.X.0) | New features, backward-compatible |
| **PATCH** (1.0.X) | Bug fixes and security patches |

[Unreleased]: https://github.com/truestlink/trust-link-backend/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/truestlink/trust-link-backend/releases/tag/v1.0.0
