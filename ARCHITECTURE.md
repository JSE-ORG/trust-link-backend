# Trust-Link Backend — Architecture

## Overview

Trust-Link Backend is a NestJS application that manages escrow transactions on the Stellar blockchain. Vendors create escrow agreements, buyers fund them via Stellar payments, and the system automatically tracks shipments, releases funds, and handles disputes.

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          External Clients                                │
│   ┌──────────────┐   ┌──────────────────┐   ┌────────────────────────┐  │
│   │  Web / Mobile │   │  Stellar Horizon  │   │  Background Workers    │  │
│   │    Clients    │   │ (webhook retries) │   │ (in-process timers)    │  │
│   └──────┬───────┘   └────────┬─────────┘   └──────────┬─────────────┘  │
└──────────┼────────────────────┼────────────────────────┼────────────────┘
           │ HTTPS              │ POST /webhooks/stellar  │ Node.js setInterval
           ▼                    ▼                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         NestJS HTTP Layer                                │
│                                                                          │
│  Global Middleware          Global Guards          Global Filters         │
│  ┌──────────────────┐   ┌────────────────────┐   ┌──────────────────┐   │
│  │ SecurityMiddleware│   │  RateLimitGuard    │   │GlobalException   │   │
│  │ LoggerMiddleware  │   │  (per-route caps)  │   │Filter            │   │
│  └──────────────────┘   └────────────────────┘   └──────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Feature Modules                                  │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │    Escrow    │  │    Vendor    │  │    Dispute   │  │   Webhooks  │  │
│  │   Module     │  │   Module     │  │   Module     │  │   Module    │  │
│  │              │  │              │  │              │  │             │  │
│  │ POST /escrow │  │ POST /vendor │  │ POST /:id/   │  │ POST        │  │
│  │ GET  /:id    │  │   /profile   │  │   dispute    │  │ /webhooks/  │  │
│  │ PATCH/:id/   │  │ GET  /vendor │  │ GET  /:id/   │  │   stellar   │  │
│  │   ship|cancel│  │   /escrows   │  │   dispute    │  │             │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
│         │                 │                  │                  │         │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                       Admin Modules                               │    │
│  │  ┌─────────────┐  ┌────────────────┐  ┌───────────────────────┐ │    │
│  │  │  AdminStats │  │  AdminDispute  │  │    QueueDashboard     │ │    │
│  │  │ GET /admin/ │  │ GET /admin/    │  │  GET /admin/queues    │ │    │
│  │  │   stats     │  │   disputes     │  │  (BullMQ placeholder) │ │    │
│  │  └─────────────┘  └────────────────┘  └───────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Shared Infrastructure Layer                         │
│                                                                          │
│  ┌─────────────────┐   ┌──────────────────┐   ┌────────────────────────┐ │
│  │  PrismaService  │   │   CacheService   │   │  NotificationsService  │ │
│  │  (PostgreSQL)   │   │   (Redis / noop) │   │  (SendGrid + Twilio)   │ │
│  │                 │   │                  │   │                        │ │
│  │  @Global()      │   │  @Global()       │   │  Optional clients      │ │
│  │  In-memory mock │   │  Graceful no-op  │   │  with retry logic      │ │
│  │  for dev/tests  │   │  when REDIS_URL  │   │  (MAX_ATTEMPTS=3)      │ │
│  │                 │   │  not set         │   │                        │ │
│  └────────┬────────┘   └────────┬─────────┘   └────────────────────────┘ │
│           │                     │                                         │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                    Auth & Config                                    │   │
│  │  ┌──────────────────────┐   ┌──────────────────────────────────┐   │   │
│  │  │   ConfigModule       │   │         Sep10Module              │   │   │
│  │  │   @Global() + Joi    │   │  SEP-10 JWT challenge/verify     │   │   │
│  │  │   validation         │   │  JwtGuard for protected routes   │   │   │
│  │  └──────────────────────┘   └──────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          External Systems                                 │
│  ┌───────────────┐   ┌────────────────┐   ┌──────────────────────────┐  │
│  │  PostgreSQL   │   │     Redis      │   │   Stellar Network        │  │
│  │               │   │                │   │                          │  │
│  │  Escrow       │   │  escrow:{id}   │   │  Horizon API             │  │
│  │  Dispute      │   │  keys, 60s TTL │   │  Smart contracts         │  │
│  │  Notification │   │                │   │  SEP-10 auth             │  │
│  │  VendorProfile│   │                │   │  Webhook callbacks       │  │
│  │  Processed    │   │                │   │                          │  │
│  │  WebhookEvent │   │                │   │                          │  │
│  └───────────────┘   └────────────────┘   └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Module Dependency Map

```
AppModule
├── ConfigModule (@Global)       — Joi-validated env config, available everywhere
├── PrismaModule (@Global)       — PostgreSQL via in-memory mock; real Prisma in prod
├── LoggerModule                 — Structured JSON logger (JsonLoggerService)
├── CacheModule (@Global)        — Redis CacheService; no-op when REDIS_URL unset
├── Sep10Module                  — SEP-10 Stellar auth challenge + JWT issuance
├── EscrowModule
│   ├── PrismaModule
│   ├── NotificationsModule      — SendGrid/Twilio dispatch with 3-attempt retry
│   └── DisputeModule            — Dispute repository and resolution logic
├── StellarModule                — ContractService: auto-release, delivery recording
├── VendorModule                 — Vendor profile CRUD
├── AdminStatsModule             — Aggregated platform statistics
├── AdminDisputeModule           — Admin dispute review and resolution
├── QueueDashboardModule         — BullMQ/ioredis queue metrics (placeholder)
├── WebhooksModule               — Stellar Horizon webhook receiver
│   └── EscrowModule (imported)
└── WorkersModule
    ├── EscrowModule
    ├── DisputeModule
    └── StellarModule
```

---

## Data Models

### Escrow (core entity)

| Field                    | Type          | Notes                            |
| ------------------------ | ------------- | -------------------------------- |
| `id`                     | UUID          | Primary key                      |
| `itemName`               | string        | 3–100 chars                      |
| `itemRef`                | string        | Vendor-scoped dedup key          |
| `amount`                 | Decimal(18,8) | Stellar asset amount             |
| `currency`               | string        | 3–12 uppercase, e.g. `USDC`      |
| `buyerAddress`           | string        | Stellar public key               |
| `vendorAddress`          | string        | Stellar public key               |
| `state`                  | EscrowState   | See state machine below          |
| `trackingId`             | string?       | Set when shipped                 |
| `shippedAt`              | DateTime?     |                                  |
| `deliveredAt`            | DateTime?     | Set by TrackingPollWorker        |
| `autoReleaseSubmittedAt` | DateTime?     | Optimistic lock for auto-release |
| `autoReleaseTxHash`      | string?       | Horizon transaction hash         |
| `disputeId`              | string?       | FK to Dispute                    |

### Dispute

| Field          | Type         | Notes                          |
| -------------- | ------------ | ------------------------------ |
| `id`           | UUID         | Primary key                    |
| `escrowId`     | UUID         | FK → Escrow (cascade delete)   |
| `reason`       | string       |                                |
| `description`  | string       |                                |
| `evidenceUrls` | string[]     |                                |
| `status`       | DisputeState | OPEN → UNDER_REVIEW → RESOLVED |

### ProcessedWebhookEvent (cursor persistence — issue #77)

| Field         | Type     | Notes                     |
| ------------- | -------- | ------------------------- |
| `operationId` | string   | PK — Stellar operation ID |
| `processedAt` | DateTime | Default now()             |

### VendorProfile

| Field          | Type    | Notes                                           |
| -------------- | ------- | ----------------------------------------------- |
| `address`      | string  | PK — Stellar public key                         |
| `businessName` | string  |                                                 |
| `email`        | string? |                                                 |
| `phone`        | string? |                                                 |
| Relationships  |         | `accountDetails`, `trackingSettings`, `escrows` |

---

## Escrow State Machine

```
              ┌─────────┐
    create ──►│  FUNDED │──── cancel ───────────────────► CANCELLED
              └────┬────┘
                   │ ship (vendor)
                   ▼
              ┌─────────┐
              │ SHIPPED │
              └────┬────┘
           ┌───────┴────────────────────────┐
           │ TrackingPollWorker              │ buyer opens dispute
           │ (every 10 min)                  ▼
           ▼                           ┌──────────┐
       ┌───────────┐                   │ DISPUTED │
       │ DELIVERED │                   └────┬─────┘
       └─────┬─────┘                        │ admin resolves
             │ AutoReleaseWorker             │
             │ (48 h after delivery,    ┌────┴─────────┐
             │  every 5 min)            ▼              ▼
             ▼                      RELEASED       REFUNDED
         ┌───────────┐
         │ COMPLETED │
         └───────────┘
```

---

## Request Lifecycle

```
HTTP Request
  │
  ├─ SecurityMiddleware          Sets CSP / HSTS headers
  ├─ LoggerMiddleware            Emits structured request log
  ├─ RateLimitGuard (global)     Enforces per-route + per-IP limits (in-process Map)
  ├─ JwtGuard (route-level)      Validates SEP-10 JWT, injects AuthUser
  │
  ├─ Controller                  Parses + validates DTO (ValidationPipe)
  ├─ EscrowService               Business logic, state validation
  │    ├─ CacheService           Read: check Redis (escrow:{id}, 60s TTL)
  │    ├─ EscrowRepository       DB read/write via PrismaService
  │    │    └─ CacheService      Write: invalidate Redis key after every mutation
  │    └─ NotificationsService   Fire-and-forget email/SMS
  │
  └─ GlobalExceptionFilter       Maps exceptions to RFC 7807 JSON responses
```

---

## Standard Error Responses

All HTTP errors are normalized by `GlobalExceptionFilter` before they leave the
API. Controllers and services should throw Nest `HttpException` subclasses (for
example `BadRequestException`, `UnauthorizedException`, `NotFoundException`) and
let the global filter write the response.

Every error response uses this envelope:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "BadRequestException",
  "timestamp": "2026-06-27T12:00:00.000Z",
  "path": "/escrow",
  "requestId": "1a1d98a2-12c2-48a9-9b4d-36e568c89b5d"
}
```

`message` may be a string array for class-validator failures. `requestId` is
resolved by `RequestIdMiddleware` from `x-request-id` or generated when absent,
then echoed in both logs and error responses. In development only, the filter may
also include `details` for diagnostics. Swagger registers the same contract as
`ErrorResponseDto` and exposes a reusable `StandardError` response component.

---

## Background Workers

Both workers implement `OnModuleInit` / `OnApplicationShutdown` for clean startup and graceful shutdown via `clearInterval`.

### AutoReleaseWorker — every 5 minutes

1. Query escrows in `SHIPPED` state where `deliveredAt` ≤ 48 h ago, no open dispute, no `autoReleaseTxHash`.
2. Call `markAutoReleaseSubmitting(id)` — sets `autoReleaseSubmittedAt` as an optimistic lock.
3. Submit on-chain auto-release via `ContractService.submitAutoRelease(escrowId)`.
4. On success: `markAutoReleaseCompleted(id, txHash)` → state becomes `COMPLETED`.
5. On failure: `clearAutoReleaseSubmitting(id)` — unlocks for next cycle.

### TrackingPollWorker — every 10 minutes

1. Query all `SHIPPED` escrows with a `trackingId`.
2. Call `LogisticsService.getStatus(trackingId)` for each.
3. On `DELIVERED` status: `markDelivered(id)` + `ContractService.recordDelivery(escrowId)`.
4. Errors are caught per-escrow so one failure doesn't block the rest.

---

## Stellar Webhook Flow (issue #76 + #77)

```
Horizon ──POST /webhooks/stellar──► StellarWebhookController
                                         │
                                    verifySignature()
                                    (HMAC-SHA256 with STELLAR_WEBHOOK_SECRET)
                                         │
                                    processedWebhookEvent.findUnique(operationId)
                                    ─── already seen? return {skipped: true} ───►
                                         │ first time
                                    processedWebhookEvent.create(operationId)
                                    (DB-persisted cursor — survives restarts)
                                         │
                                    processEvent(dto)
                                    ─── type === 'payment'? ──►
                                         │
                                    escrowRepository.findByBuyer(dto.to)
                                    filter state === FUNDED
                                    escrowRepository.updateState(id, FUNDED)
                                         │
                                    ─── error? delete cursor, rethrow ──────────►
```

---

## Caching Strategy (issue #103)

- **Store**: Redis (ioredis), configured via `REDIS_URL`.
- **Scope**: `GET /escrow/:id` only — single-record lookups under burst traffic.
- **Key format**: `escrow:{uuid}` — one key per escrow ID.
- **TTL**: 60 seconds.
- **Read path**: `EscrowRepository.findById` checks Redis before hitting PostgreSQL.
- **Invalidation**: Every `EscrowRepository` write method (`markShipped`, `markCancelled`, `markDelivered`, `markAutoReleased`, `updateState`, etc.) calls `cache.del(escrow:{id})` immediately after the DB mutation.
- **Graceful degradation**: If `REDIS_URL` is not set, `CacheService` is a no-op — reads always hit PostgreSQL, no errors.

---

## Authentication

SEP-10 (Stellar Ecosystem Proposal) is used for wallet-native authentication:

1. Client calls `GET /auth` with its Stellar public key.
2. Server returns a signed challenge transaction.
3. Client signs with its private key and submits to `POST /auth`.
4. Server verifies the signature and issues a JWT (`SEP10_JWT_SECRET`, HS256).
5. Protected endpoints use `@UseGuards(JwtGuard)` + `@CurrentUser()` to extract the verified Stellar address.

---

## Security Controls

| Layer             | Mechanism                                                      |
| ----------------- | -------------------------------------------------------------- |
| Transport         | HTTPS enforced in production                                   |
| Headers           | SecurityMiddleware: CSP, HSTS, X-Frame-Options                 |
| CORS              | `ALLOWED_ORIGINS` allowlist; blocks all in production if unset |
| Auth              | SEP-10 JWT on protected routes                                 |
| Rate limiting     | `RateLimitGuard` with per-route limits (5–100 req/min)         |
| Webhook integrity | HMAC-SHA256 signature verification (`X-Stellar-Signature`)     |
| Input validation  | `ValidationPipe` (whitelist, transform, forbid extra fields)   |
| SQL injection     | Parameterised queries via Prisma ORM                           |

---

## Environment Configuration Summary

| Variable                 | Required | Default         | Purpose                               |
| ------------------------ | -------- | --------------- | ------------------------------------- |
| `DATABASE_URL`           | Yes      | —               | PostgreSQL connection string          |
| `SEP10_JWT_SECRET`       | Yes      | —               | JWT signing secret (min 32 chars)     |
| `ADMIN_ADDRESS`          | Yes      | —               | Admin Stellar public key              |
| `PORT`                   | No       | `3000`          | HTTP listen port                      |
| `NODE_ENV`               | No       | `development`   | Runtime mode                          |
| `STELLAR_NETWORK`        | No       | `TESTNET`       | `TESTNET` or `MAINNET`                |
| `STELLAR_HORIZON_URL`    | No       | Horizon default | Horizon API base URL                  |
| `STELLAR_WEBHOOK_SECRET` | No       | —               | HMAC secret for webhook verification  |
| `REDIS_URL`              | No       | —               | Redis URL; caching disabled if absent |
| `ALLOWED_ORIGINS`        | No       | —               | Comma-separated CORS allowlist        |
| `SENDGRID_API_KEY`       | No       | —               | Email notifications                   |
| `TWILIO_ACCOUNT_SID`     | No       | —               | SMS notifications                     |
| `TWILIO_AUTH_TOKEN`      | No       | —               | SMS notifications                     |
| `LOG_LEVEL`              | No       | `info`          | `trace│debug│info│warn│error│fatal`   |

See [.env.example](.env.example) for format descriptions and example values.

---

## Key File Locations

| Path                   | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `src/app.module.ts`    | Root module — all imports and global middleware                     |
| `src/main.ts`          | Bootstrap — CORS, ValidationPipe, graceful shutdown                 |
| `src/config/`          | Joi-validated env config (`ConfigModule`, `ConfigService`)          |
| `src/escrow/`          | Core escrow CRUD, state machine, dispute endpoints                  |
| `src/stellar/`         | Stellar contract calls (auto-release, delivery, dispute resolution) |
| `src/webhooks/`        | Horizon webhook receiver with HMAC verification and DB cursor       |
| `src/workers/`         | `AutoReleaseWorker` (5 min) and `TrackingPollWorker` (10 min)       |
| `src/cache/`           | `CacheService` (Redis) and `CacheModule`                            |
| `src/prisma/`          | `PrismaService` — in-memory mock for dev/tests                      |
| `src/notifications/`   | SendGrid + Twilio dispatch with retry                               |
| `src/auth/`            | SEP-10 challenge, JWT issuance, `JwtGuard`                          |
| `src/common/`          | Guards, filters, middleware, logger                                 |
| `prisma/schema.prisma` | Prisma data model                                                   |
| `prisma/migrations/`   | Versioned SQL migrations                                            |
