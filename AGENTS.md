# Anchored Summary — trustlink-backend

## What We've Done
Phase 1–3 of unit test fixes complete. All **65 test suites, 642 tests passing** (integration + unit).

### Phase 4 — Real PrismaClient (In-Progress)
Replaced the 1532-line in-memory PrismaService fake with a real `PrismaClient` using `@prisma/adapter-pg` (Prisma v7 driver adapter). This removes all Map-based stores and delegates all queries to PostgreSQL.

#### Core Changes
- `src/prisma/prisma.service.ts` — extends `PrismaClient` instead of in-memory Map stores
  - Constructor accepts optional `databaseUrl` (falls back to `process.env.DATABASE_URL`)
  - Creates `PrismaPg` adapter with connection string internally
  - Applies `statement_timeout` and `connect_timeout` to URL
  - `onModuleInit()` calls `$connect()` and registers slow-query logger via `$on('query')`
  - `onModuleDestroy()` calls `$disconnect()`
  - `reset()` executes `TRUNCATE TABLE ... CASCADE` on all public tables (skips `_prisma_migrations`)
  - All custom type exports preserved for backward compatibility
- `src/prisma/prisma.module.ts` — comment-only update
- `.github/workflows/ci.yml` — added Postgres 16 service (matched from `test.yml`)

#### Behavioral Fixes
- `src/escrow/buyer-dispute.service.ts` — `openDispute()` now explicitly calls `escrowRepository.updateState(escrowId, 'DISPUTED')` after creating a dispute (in-memory fake auto-transitioned escrow as side-effect; real DB does not)
- `test/integration/vendor-analytics.integration-spec.ts` — removed `(prisma as any).escrows.set(...)`; now passes `createdAt` directly to `prisma.escrow.create()`
- `src/prisma/prisma.service.spec.ts`, `test/unit/prisma.service.spec.ts`, `test/unit/prisma-schema-parity.spec.ts`, `src/prisma/escrow-event-logging.spec.ts` — updated for real PrismaClient API

#### Known Behavioral Changes
- `prisma.escrow.findMany()` no longer auto-filters CANCELLED records (remove CANCELLED-hiding behavior). All records are returned unless a `state` filter is provided.
- `prisma.escrow.create()` / `prisma.escrow.update()` no longer auto-create `EscrowEvent` rows — event logging must be done explicitly.
- `prisma.dispute.create()` no longer auto-transitions escrow to DISPUTED — handled by `BuyerDisputeService`.
- `amount` fields are `Prisma.Decimal` at runtime (not `number`). Use `toEqual()` instead of `toBe()` for comparisons, or call `Number(escrow.amount)` for arithmetic.

#### Prerequisites
- PostgreSQL must be running on `localhost:5432` with `trustlink_test` database
- `DATABASE_URL` in `.env.test` points to `postgresql://postgres:postgres@localhost:5432/trustlink_test`

### Earlier Work
All 24 integration test suites (182 tests) passing after:
- CI Node v20→v22, baseline migration, `SENTRY_DSN` fix, Stellar addresses, `Idempotency-Key` header
- `markAutoReleaseSubmitting` race condition → atomic `updateMany`
- `PrismaService` in-memory mock additions (`updateMany`, `CacheService.del`, etc.)

## Key Files Modified
- `src/prisma/prisma.service.ts` — full rewrite (extends PrismaClient + PrismaPg adapter)
- `src/prisma/prisma.module.ts` — comment update
- `src/escrow/buyer-dispute.service.ts` — explicit escrow state transition
- `src/prisma/prisma.service.spec.ts` — updated for real DB
- `src/prisma/escrow-event-logging.spec.ts` — updated for real DB
- `test/unit/prisma.service.spec.ts` — updated for real DB
- `test/unit/prisma-schema-parity.spec.ts` — updated for real DB
- `test/integration/vendor-analytics.integration-spec.ts` — removed direct store access
- `.github/workflows/ci.yml` — added Postgres service

## Jest Config
- `jest-integration.json`: `testTimeout: 60000`
- Unit tests use default Jest config (standalone files, no `AppModule`)
