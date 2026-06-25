# TrustLink Backend — Specification Requirements Document (SRD)

> **Purpose**: This document is the authoritative specification for the TrustLink Backend. Every code change MUST conform to these requirements. It serves as the contract between maintainers and contributors — any PR that violates these specifications MUST be rejected.

---

## 1. Project Overview

### 1.1 Purpose

TrustLink Backend is a NestJS application that manages **escrow transactions on the Stellar blockchain**. It enables secure peer-to-peer commerce by holding funds in escrow, tracking physical shipment via logistics providers, and automatically releasing funds upon delivery confirmation.

### 1.2 Scope

The system covers:
- Escrow lifecycle management (creation → funding → shipping → delivery → release)
- SEP-10 Stellar wallet authentication with JWT issuance and refresh token rotation
- Logistics tracking (GIGL, Terminal Africa, with carrier auto-detection)
- Automated fund release (48 hours after delivery confirmation)
- Dispute resolution (buyer-initiated, admin-mediated)
- Webhook receiver for Stellar Horizon events
- Vendor management (profiles, analytics, notification preferences)
- Admin operations (stats, dispute resolution, queue monitoring, DLQ management)

### 1.3 Out of Scope

- Frontend applications (separate repositories)
- Smart contract development (Soroban contracts are deployed independently)
- Stellar Horizon infrastructure
- Third-party logistics provider infrastructure

---

## 2. Technical Stack Specification

### 2.1 Runtime

| Requirement | Specification | Enforcement |
|---|---|---|
| R-TS-01 | Node.js 20.x LTS | CI must use `node-version: '20'` |
| R-TS-02 | TypeScript 5.7+ with `strict: true` | `tsconfig.json` must enforce strict mode |
| R-TS-03 | ES2023 target | `tsconfig.json` target must be ES2023 |
| R-TS-04 | Module system: NodeNext | `tsconfig.json` module must be NodeNext |

### 2.2 Framework

| Requirement | Specification | Enforcement |
|---|---|---|
| R-FW-01 | NestJS 11.x with Express platform | `package.json` must specify `@nestjs/core@^11` |
| R-FW-02 | Dependency injection via `@Injectable()` decorators | All services must use DI |
| R-FW-03 | Global pipes: ValidationPipe + SanitizationPipe | `main.ts` must register both |
| R-FW-04 | Global exception filter for consistent error responses | `AppModule` must register `APP_FILTER` |
| R-FW-05 | Swagger/OpenAPI at `/api/docs` | `main.ts` must configure Swagger |

### 2.3 Data Layer

| Requirement | Specification | Enforcement |
|---|---|---|
| R-DB-01 | PostgreSQL 15+ via Prisma ORM 7.x | `prisma/schema.prisma` is the single source of truth |
| R-DB-02 | All database access through repository pattern | Services must NOT call `prisma` directly |
| R-DB-03 | Every schema change requires a Prisma migration | Migration files must be committed alongside schema changes |
| R-DB-04 | No destructive migrations without data handling plan | Dropping columns/tables requires a comment explaining backfill |

### 2.4 Caching

| Requirement | Specification | Enforcement |
|---|---|---|
| R-CA-01 | Redis 7.x via ioredis for response caching | CacheService must use ioredis when REDIS_URL is set |
| R-CA-02 | Graceful degradation when Redis is unavailable | CacheService must no-op without REDIS_URL, never crash |
| R-CA-03 | Cache TTL must not exceed 60 seconds for escrow data | TTL must be configurable, default 60s |
| R-CA-04 | Writes must invalidate cache immediately | Every state mutation must call `cache.del()` after DB write |

### 2.5 Queue System

| Requirement | Specification | Enforcement |
|---|---|---|
| R-QS-01 | BullMQ backed by Redis for job queues | Notification retry must use BullMQ |
| R-QS-02 | In-memory fallback when Redis is unavailable | Development mode must work without Redis |
| R-QS-03 | Exponential backoff for notification retries | 1s → 2s → 4s → 8s → 16s (max 5 attempts) |

### 2.6 Observability

| Requirement | Specification | Enforcement |
|---|---|---|
| R-OB-01 | Structured JSON logging for all modules | All log output must use Logger service, never console.log |
| R-OB-02 | Request correlation ID on every request | RequestIdMiddleware must inject and propagate X-Request-ID |
| R-OB-03 | OpenTelemetry distributed tracing | Span must be created for each request handler |
| R-OB-04 | Sentry error tracking (optional) | SENTRY_DSN enables Sentry; app must work without it |
| R-OB-05 | Health check at GET /health | Must report db, horizon, redis status with 200/503 |

---

## 3. Architecture Specification

### 3.1 Module Structure

Every feature MUST follow the NestJS module convention:

```
src/<feature>/
├── <feature>.module.ts        # @Module decorator, imports, providers, exports
├── <feature>.controller.ts    # HTTP routes only — no business logic
├── <feature>.service.ts       # Business logic only — no HTTP/DB direct calls
├── <feature>.repository.ts    # Database access only — Prisma queries
└── dto/                       # Request/response validation DTOs
```

**Rules**:
- R-ARCH-01: Controllers must only parse input, call service, return response. No business logic.
- R-ARCH-02: Services must contain business logic. No direct Prisma calls.
- R-ARCH-03: Repositories must contain all database queries. No business logic.
- R-ARCH-04: Stellar SDK calls must only live in `src/stellar/`. No `stellar-sdk` imports elsewhere.
- R-ARCH-05: Background workers must live in `src/workers/`. No `setInterval` in services.
- R-ARCH-06: Shared guards, filters, middleware must live in `src/common/`.

### 3.2 Layer Boundaries

```
HTTP Request
  │
  ├─ Middleware (Security, Logger, RequestId)
  ├─ Guard (JwtGuard, AdminGuard, ThrottlerGuard)
  ├─ Pipe (ValidationPipe, SanitizationPipe)
  ├─ Controller (parse DTO, delegate to service)
  ├─ Service (business logic, orchestration)
  │    ├─ Repository (Prisma queries)
  │    ├─ CacheService (Redis read/write)
  │    └─ External services (Stellar, SendGrid, Twilio, Logistics)
  └─ Filter (GlobalExceptionFilter → consistent error response)
```

### 3.3 Escrow State Machine

```
CREATED → FUNDED → SHIPPED → DELIVERED → COMPLETED/RELEASED
                                      ↘ DISPUTED → RELEASED/REFUNDED
CREATED/FUNDED → CANCELLED
```

R-ARCH-07: All state transitions must be validated against the state machine. Invalid transitions must throw `BadRequestException`.
R-ARCH-08: Every state transition must log an `EscrowEvent` record.
R-ARCH-09: State transitions must invalidate Redis cache immediately.

### 3.4 Background Workers

| Worker | Interval | Responsibility |
|---|---|---|
| AutoReleaseWorker | 5 minutes | Release escrows delivered 48+ hours ago |
| TrackingPollWorker | 10 minutes | Poll logistics providers for delivery updates |

R-ARCH-10: Workers must implement `OnModuleInit` / `OnApplicationShutdown` for clean startup/shutdown.
R-ARCH-11: Workers must handle per-escrow errors independently — one failure must not block the batch.
R-ARCH-12: Workers must use optimistic locking to prevent concurrent duplicate processing.

---

## 4. Authentication & Authorization Specification

### 4.1 SEP-10 Authentication

R-AUTH-01: Authentication must use Stellar SEP-10 challenge-response protocol.
R-AUTH-02: Challenge nonces must be stored in the database with a single-use flag.
R-AUTH-03: Nonces must expire after 15 minutes (configurable via NONCE_TTL).
R-AUTH-04: Used or expired nonces must reject with `UnauthorizedException`.
R-AUTH-05: JWT tokens must be signed with HS256 using SEP10_JWT_SECRET (min 32 chars).

### 4.2 JWT Structure

```
Header:  { alg: "HS256", typ: "JWT" }
Payload: { sub: "<stellar-address>", iat: <unix-epoch>, exp: <unix-epoch + 3600> }
```

R-AUTH-06: JWT expiry must be 1 hour.
R-AUTH-07: JWT must include `role: 'admin'` claim when the user address matches ADMIN_ADDRESS.

### 4.3 Authorization

R-AUTH-08: `JwtGuard` must verify the HMAC-SHA256 signature of every JWT. Tokens with invalid signatures must return 401.
R-AUTH-09: `AdminGuard` must check both the JWT role claim and address against ADMIN_ADDRESS.
R-AUTH-10: Vendor-scoped endpoints (ship, cancel, escrow list) must verify the authenticated user owns the resource.
R-AUTH-11: Cross-vendor access attempts must return 403 Forbidden.

### 4.4 Refresh Token Rotation

R-AUTH-12: Refresh tokens must be single-use with family-based revocation.
R-AUTH-13: Reuse of a revoked refresh token must invalidate the entire token family.
R-AUTH-14: Refresh tokens must expire after 7 days (configurable via REFRESH_TOKEN_TTL).
R-AUTH-15: Refresh tokens must be hashed with HMAC-SHA256 before storage.

---

## 5. API Specification

### 5.1 Endpoint Requirements

R-API-01: All endpoints must have Swagger annotations: `@ApiTags`, `@ApiOperation`, `@ApiResponse`.
R-API-02: All request DTOs must have `class-validator` decorators.
R-API-03: All DTO properties must have `@ApiProperty` with `example` and `description`.
R-API-04: All response DTOs must document 200, 400, 401, 403, 404, 429, 500 response codes.
R-API-05: All endpoints must return consistent error format: `{ statusCode, message, error, timestamp, path, requestId }`.
R-API-06: Public endpoints must be rate-limited (60 req/min default, 10 req/min for auth challenge).
R-API-07: String inputs must pass through SanitizationPipe (HTML stripping, control char removal).

### 5.2 Route Map

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| GET | `/health` | None | — |
| GET | `/version` | None | — |
| POST | `/auth/challenge` | None | 10/min |
| POST | `/auth` | None | 10/min |
| POST | `/auth/refresh` | None | 10/min |
| POST | `/escrow` | JWT | 60/min |
| GET | `/escrow/:id` | None | 60/min |
| GET | `/escrow/:id/events` | None | 60/min |
| GET | `/escrow/:id/tracking` | None | 60/min |
| PATCH | `/escrow/:id/buyer-contact` | None | 5/min |
| PATCH | `/escrow/:id/ship` | JWT | 60/min |
| PATCH | `/escrow/:id/cancel` | JWT | 60/min |
| DELETE | `/escrow/:id` | JWT | 60/min |
| POST | `/escrow/:id/dispute` | JWT | 60/min |
| GET | `/escrow/:id/dispute` | JWT | 60/min |
| POST | `/escrow/evidence-upload` | JWT | 10/min |
| GET | `/vendor/escrows` | JWT | 60/min |
| POST | `/vendor/profile` | JWT | 60/min |
| GET | `/vendor/profile` | JWT | 60/min |
| PUT | `/vendor/profile` | JWT | 60/min |
| PATCH | `/vendor/profile` | JWT | 60/min |
| GET | `/vendor/profile/notifications` | JWT | 60/min |
| PATCH | `/vendor/profile/notifications` | JWT | 60/min |
| GET | `/vendor/analytics` | JWT | 60/min |
| GET | `/vendor/analytics/chart` | JWT | 60/min |
| POST | `/webhooks/stellar` | HMAC | — |
| GET | `/admin/stats` | JWT+Admin | 60/min |
| GET | `/admin/disputes` | JWT+Admin | 60/min |
| PATCH | `/admin/dispute/:id/resolve` | JWT+Admin | 60/min |
| GET | `/admin/queues` | JWT+Admin | 60/min |
| GET | `/admin/audit-log` | JWT+Admin | 60/min |
| PATCH | `/admin/credentials/logistics` | JWT+Admin | 60/min |
| GET | `/admin/dlq` | JWT+Admin | 60/min |
| POST | `/admin/dlq/:id/replay` | JWT+Admin | 60/min |
| POST | `/admin/dlq/:id/abandon` | JWT+Admin | 60/min |

---

## 6. Security Specification

### 6.1 Data Protection

R-SEC-01: Buyer contact information (email, phone) must be encrypted at rest using AES-256-GCM.
R-SEC-02: Logistics API credentials must be encrypted at rest.
R-SEC-03: JWT secrets must be at least 32 characters, cryptographically random.
R-SEC-04: No secrets, keys, or passwords may be hardcoded. All must come from environment variables.
R-SEC-05: `.env` files must never be committed to version control.

### 6.2 Network Security

R-SEC-06: Helmet middleware must set CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers.
R-SEC-07: CORS must restrict cross-origin requests to configured ALLOWED_ORIGINS.
R-SEC-08: In production, empty ALLOWED_ORIGINS must block all cross-origin requests.
R-SEC-09: HTTPS must be enforced at the load balancer/ingress level in production.

### 6.3 Input Validation

R-SEC-10: All string inputs must pass through SanitizationPipe to strip HTML tags and control characters.
R-SEC-11: All DTOs must have `class-validator` decorators with appropriate constraints.
R-SEC-12: File uploads must be validated by magic bytes, not just file extension.
R-SEC-13: Pagination parameters must be validated (positive integers, max limit 100).
R-SEC-14: Request body size must be limited (1MB max for webhooks, 10MB for evidence uploads).

### 6.4 Webhook Security

R-SEC-15: All webhooks must verify HMAC-SHA256 signature using constant-time comparison.
R-SEC-16: Signature verification must use the raw request body, not reconstructed JSON.
R-SEC-17: Raw body middleware must be configured in main.ts before webhook routes.
R-SEC-18: Idempotency must prevent duplicate webhook processing via ProcessedWebhookEvent table.
R-SEC-19: Webhook processing failures must roll back the cursor to allow retry.

### 6.5 Rate Limiting

R-SEC-20: Public endpoints must be rate-limited at 60 requests/minute per IP.
R-SEC-21: Auth challenge endpoints must be rate-limited at 10 requests/minute per IP.
R-SEC-22: Evidence upload must be rate-limited at 10 requests/minute per user.
R-SEC-23: Rate limit exceeded must return 429 with Retry-After header.

---

## 7. Testing Specification

### 7.1 Test Coverage Requirements

R-TST-01: Every service method must have at least one unit test.
R-TST-02: Every controller endpoint must have at least one integration test.
R-TST-03: Every critical user flow must have an E2E test.
R-TST-04: Overall code coverage must not drop below 70%.
R-TST-05: PRs that reduce coverage by more than 2% must be rejected.

### 7.2 Test Types

| Test Type | Location | What It Tests | Dependencies |
|---|---|---|---|
| Unit | `test/unit/` | Single service/repository in isolation | All mocks via Jest |
| Integration | `test/integration/` | Full module with real DB | PostgreSQL (in-memory or Docker) |
| E2E | `test/` | HTTP request → response cycle | PostgreSQL + full app bootstrap |

R-TST-06: Unit tests must mock all external dependencies (Prisma, Stellar SDK, HTTP clients).
R-TST-07: Integration tests must use a real or in-memory database, not mocked Prisma.
R-TST-08: E2E tests must use `supertest` against the bootstrapped NestJS app.
R-TST-09: Tests must not depend on external network access (Stellar, logistics APIs, etc.).
R-TST-10: Tests must be deterministic — same inputs must always produce same outputs.

### 7.3 Critical Test Paths

The following paths MUST have test coverage:

- R-TST-11: SEP-10 challenge generation and verification
- R-TST-12: JWT signature verification (valid → accept, forged → reject)
- R-TST-13: Admin authorization (admin → 200, vendor → 403)
- R-TST-14: Escrow state machine transitions (all valid and invalid paths)
- R-TST-15: Auto-release optimistic locking (concurrent access)
- R-TST-16: Webhook HMAC verification (valid → accept, tampered → reject)
- R-TST-17: Refresh token rotation (valid → rotate, reused → revoke family)
- R-TST-18: Rate limit enforcement (within limit → 200, exceeded → 429)

---

## 8. CI/CD Specification

### 8.1 Required CI Checks

R-CI-01: Every PR and push to main must trigger CI.
R-CI-02: `npm run lint:check` must pass with zero errors.
R-CI-03: `npm run typecheck` must pass with zero errors.
R-CI-04: `npm run test` must pass with all tests green.
R-CI-05: `npm run test:cov` must pass with coverage above threshold.
R-CI-06: `npm run build` must pass with zero errors.
R-CI-07: Integration tests must run against a PostgreSQL service container.
R-CI-08: `npm audit` must pass — no critical or high vulnerabilities.
R-CI-09: All CI checks must complete within 15 minutes.

### 8.2 Required GitHub Protections

R-CI-10: The `main` branch must be protected:
  - Require pull request reviews (minimum 1 approval)
  - Require status checks (all CI checks must pass)
  - Require branches to be up-to-date before merging
  - Require linear history (no merge commits)
  - Do not allow force pushes

R-CI-11: Changes to Stellar transaction signing, auto-release logic, or dispute resolution require 2 approvals.

### 8.3 Dependabot

R-CI-12: Dependabot must be configured for npm and GitHub Actions updates.
R-CI-13: Updates must be checked weekly.
R-CI-14: Production and development dependencies must be grouped separately.
R-CI-15: Maximum 5 open Dependabot PRs at a time.

---

## 9. Code Quality Specification

### 9.1 TypeScript Standards

R-CS-01: All functions must have explicit return type annotations.
R-CS-02: All variables must have explicit type annotations — `any` is forbidden.
R-CS-03: All async functions must use `async/await`, never raw `.then()` chains.
R-CS-04: All thrown errors must be NestJS `HttpException` subclasses.
R-CS-05: All magic numbers and strings must be extracted to named constants.
R-CS-06: All imports must be ordered: external → internal.
R-CS-07: Prettier formatting must be applied to all files.

### 9.2 Naming Conventions

R-CS-08: Classes: PascalCase (`EscrowService`, `JwtGuard`)
R-CS-09: Methods: camelCase (`createEscrow`, `findById`)
R-CS-10: Variables: camelCase (`vendorAddress`, `escrowId`)
R-CS-11: Files: kebab-case (`escrow.service.ts`, `jwt.guard.ts`)
R-CS-12: DTOs: PascalCase with Dto suffix (`CreateEscrowDto`)
R-CS-13: Interfaces: PascalCase with no prefix (`EscrowRecord`, `AuthUser`)
R-CS-14: Enums: PascalCase (`EscrowState`, `DisputeStatus`)

### 9.3 Commit Convention

R-CS-15: All commits must follow Conventional Commits format:
  ```
  <type>(<scope>): <short imperative description>
  ```
R-CS-16: Types: `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `chore`, `security`
R-CS-17: Commit messages must reference the issue number: `Closes #123`

---

## 10. Documentation Specification

### 10.1 Required Documentation

R-DOC-01: All environment variables must be documented in `.env.example` with descriptions.
R-DOC-02: All controller methods must have JSDoc with `@param`, `@returns`, and `@throws`.
R-DOC-03: All DTO classes must have JSDoc explaining the DTO purpose.
R-DOC-04: All service and repository methods must have JSDoc.
R-DOC-05: Swagger must be configured and accessible at `/api/docs`.
R-DOC-06: `ARCHITECTURE.md` must be kept up to date with module structure and data flow.
R-DOC-07: `CHANGELOG.md` must be updated with every release following semantic versioning.

### 10.2 PR Documentation

R-DOC-08: Every PR must include:
  - Summary of what changed
  - Motivation with issue link
  - Bullet-point list of key changes
  - Testing section describing what tests were added
  - Migration section if schema changed

---

## 11. Error Handling Specification

### 11.1 Error Response Format

All errors must return the following JSON structure:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-06-23T12:00:00.000Z",
  "path": "/api/escrow",
  "requestId": "req-abc123"
}
```

R-ERR-01: `GlobalExceptionFilter` must catch all unhandled exceptions.
R-ERR-02: Prisma errors must be mapped to appropriate HTTP codes (P2002 → 409, P2025 → 404).
R-ERR-03: Development mode must include stack traces. Production mode must not.
R-ERR-04: All errors must be logged with correlation ID before the response is sent.

### 11.2 HTTP Status Code Usage

| Code | Usage | Example |
|---|---|---|
| 200 | Success | GET /escrow/:id |
| 201 | Created | POST /escrow |
| 400 | Bad Request | Invalid DTO validation |
| 401 | Unauthorized | Missing/invalid JWT |
| 403 | Forbidden | Non-admin on admin endpoint |
| 404 | Not Found | Escrow ID not found |
| 409 | Conflict | Duplicate escrow |
| 413 | Payload Too Large | Request body exceeds limit |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unhandled exception |

---

## 12. Configuration Specification

### 12.1 Required Environment Variables

| Variable | Required | Validation | Secret |
|---|---|---|---|
| `DATABASE_URL` | YES | Valid PostgreSQL URL | YES |
| `SEP10_JWT_SECRET` | YES | Min 32 characters | YES |
| `ADMIN_ADDRESS` | YES | Valid Stellar G... key | NO |
| `STELLAR_NETWORK` | NO (default: TESTNET) | TESTNET or MAINNET | NO |
| `STELLAR_HORIZON_URL` | NO | Valid URL | NO |
| `STELLAR_WEBHOOK_SECRET` | NO | Min 16 characters | YES |
| `CONTACT_ENCRYPTION_KEY` | YES | 64 hex chars (32 bytes) | YES |
| `REDIS_URL` | NO | Valid redis:// URL | optional |
| `ALLOWED_ORIGINS` | NO | Comma-separated URLs | NO |
| `SENDGRID_API_KEY` | NO | Valid SendGrid key | YES |
| `TWILIO_ACCOUNT_SID` | NO | Valid Twilio SID | YES |
| `TWILIO_AUTH_TOKEN` | NO | Valid Twilio token | YES |
| `SENTRY_DSN` | NO | Valid Sentry DSN | YES |

R-CFG-01: All environment variables must be validated at startup via Joi schema.
R-CFG-02: Missing required variables must prevent application startup with a clear error message.
R-CFG-03: `enableImplicitConversion` must not be used in ValidationPipe.
R-CFG-04: All errors must show all validation failures (abortEarly: false).

---

## 13. Dependencies Specification

### 13.1 Allowed Dependencies

R-DEP-01: No new dependencies may be added without maintainer review.
R-DEP-02: All dependencies must have OSI-approved licenses (MIT, Apache-2.0, ISC, BSD).
R-DEP-03: Dependencies with GPL, AGPL, or unlicensed status are prohibited.
R-DEP-04: `npm audit` must show zero critical or high vulnerabilities.
R-DEP-05: Dependabot must automatically open PRs for dependency updates.
R-DEP-06: Major version upgrades require manual review and testing.

### 13.2 Current Approved Stack

| Category | Package | Version | Purpose |
|---|---|---|---|
| Framework | `@nestjs/core` | ^11 | Application framework |
| ORM | `@prisma/client` | ^7 | Database access |
| Blockchain | `@stellar/stellar-sdk` | ^15 | Stellar network interaction |
| Validation | `class-validator`, `joi` | latest | Input validation |
| Queue | `bullmq`, `ioredis` | latest | Job queues + Redis client |
| Docs | `@nestjs/swagger` | ^11 | OpenAPI documentation |
| Security | `helmet` | ^8 | HTTP security headers |
| Monitoring | `@sentry/nestjs` | ^10 | Error tracking |
| Tracing | `@opentelemetry/*` | latest | Distributed tracing |

---

## 14. Deployment Specification

### 14.1 Build Requirements

R-DPL-01: Production build must use multi-stage Docker build (`node:20-alpine`).
R-DPL-02: Final Docker image must contain only production dependencies.
R-DPL-03: Docker image must run as non-root user (`nestjs`, UID 1001).
R-DPL-04: Docker image must have a health check via `GET /health`.
R-DPL-05: `npm ci` must be used instead of `npm install` for deterministic builds.

### 14.2 Migration Order

R-DPL-06: Database backup must be taken before every migration.
R-DPL-07: Migrations must be applied before starting new application instances.
R-DPL-08: One canary instance must be validated before full rollout.
R-DPL-09: Rollback must revert the application image and restore the database backup.

---

## 15. Compliance Verification

### 15.1 Automated Enforcement

The following checks MUST be automated in CI:

| Check | Tool | Spec Reference |
|---|---|---|
| TypeScript compilation | `tsc --noEmit` | R-TS-02, R-CS-01, R-CS-02 |
| ESLint | `eslint` | R-CS-01 through R-CS-08 |
| Prettier formatting | `prettier --check` | R-CS-07 |
| Unit tests | `jest` | R-TST-01 through R-TST-10 |
| Coverage threshold | `scripts/check_coverage.js` | R-TST-04, R-TST-05 |
| Integration tests | `jest --config test/jest-integration.json` | R-TST-02 |
| E2E tests | `jest --config test/jest-e2e.json` | R-TST-03 |
| npm audit | `npm audit` | R-DEP-04 |
| Build | `nest build` | R-CI-06 |

### 15.2 Manual Enforcement (Code Review)

Reviewers MUST verify the following before approving a PR:

1. All CI checks pass
2. No security-sensitive code in the PR (secrets, keys, etc.)
3. Tests exist for all new/changed code
4. Swagger annotations are present and accurate
5. No environment variables hardcoded
6. Migration files are present if schema changed
7. Branch name follows convention (`feat/`, `fix/`, `test/`, etc.)
8. Commit messages follow Conventional Commits
9. PR description includes required sections (Summary, Motivation, Changes, Testing)

---

## 16. Specification Change Process

### 16.1 Amending This Document

R-SPC-01: Changes to this specification require a PR that modifies SPECIFICATION.md.
R-SPC-02: Spec changes require 2 maintainer approvals.
R-SPC-03: Spec changes must be documented in CHANGELOG.md under a new version.
R-SPC-04: All existing code must comply with the new spec within 30 days of amendment, or the spec must include a transition plan.

---

*This document is maintained by the TrustLink maintainers. Last updated: 2026-06-23.*
