# Production Deployment Guide

## Overview

This guide defines the production deployment order for the Trust-Link backend. Use it for staging and production releases so infrastructure, database migrations, service rollout, and validation happen in a consistent sequence.

## Infrastructure Prerequisites

- Node.js 20 runtime.
- PostgreSQL 15 or newer.
- Redis for response and tracking cache when `REDIS_URL` is configured.
- Stellar Horizon access for the selected network.
- SendGrid and Twilio credentials when notifications are enabled.
- HTTPS termination at the load balancer or ingress.
- Centralized log collection for JSON logs.
- OpenTelemetry collector when tracing is enabled.

## Environment Rules

Set all required variables before running migrations or starting the service:

- `NODE_ENV=production`
- `PORT`
- `DATABASE_URL`
- `SEP10_JWT_SECRET`
- `ADMIN_ADDRESS`
- `STELLAR_NETWORK`
- `STELLAR_WEBHOOK_SECRET`
- `REDIS_URL`
- `ALLOWED_ORIGINS`
- `API_BASE_URL`
- `SENDGRID_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `OTEL_ENABLED`
- `OTEL_EXPORTER_OTLP_ENDPOINT`

Keep secrets in the deployment platform secret manager. Do not bake them into images, workflow files, or migration scripts.

## Migration Order

1. Confirm the target `DATABASE_URL` points at the production database.
2. Take a database backup and record the backup identifier in the release notes.
3. Run `npm ci` in a clean build environment.
4. Run `npm run db:generate`.
5. Apply migrations with `npm run db:migrate` or the platform migration job.
6. Verify Prisma can connect with a read-only health query.
7. Start one application instance against the migrated database.
8. Verify health, auth, escrow reads, admin reads, webhooks, and notification queues.
9. Roll out remaining instances after validation passes.

Never run application instances from a new build against an old schema when the release includes required schema changes.

## Pipeline Steps

1. Install dependencies: `npm ci`.
2. Type-check: `npm run typecheck`.
3. Lint: `npm run lint:check`.
4. Unit tests with coverage: `npm run test:cov`.
5. Coverage gate: `node scripts/check_coverage.js`.
6. Build: `npm run build`.
7. Build container image: `npm run docker:build`.
8. Run database migration job.
9. Deploy one canary instance.
10. Promote to full rollout after validation milestones pass.

## Validation Milestones

- The service starts without configuration warnings for required production variables.
- `GET /health` returns a successful response.
- `GET /version` returns the expected release version.
- SEP-10 challenge and verify flows issue tokens.
- Vendor escrow list queries return within the expected latency budget.
- Admin endpoints return 403 for vendor tokens and 200 for admin tokens.
- `PATCH /admin/dispute/:id/resolve` is reachable only by admin JWTs.
- Webhook signature validation rejects missing or invalid signatures.
- Queue dashboard and logs show no failed background jobs.
- Error rate and p95 latency remain stable for at least one canary window.

## Automated DB Migration Workflow

The `.github/workflows/db-migrate.yml` workflow applies Prisma migrations automatically.

**Triggers:**
- Runs on every push to `main`
- Runs on pull requests (status check)
- Supports manual dispatch with a `dry_run` option via the GitHub Actions UI

**Dry run (preview without applying):**
1. Go to Actions → Database Migrations → Run workflow
2. Set `dry_run` to `true`
3. The workflow runs `prisma migrate status` to show pending migrations without applying them

**Migration status check:**
After every run (apply or dry run), `prisma migrate status` is executed so the log confirms which migrations were applied and the schema is in sync.

**Running migrations before integration / E2E tests:**
The `test.yml` workflow already runs `npx prisma migrate deploy` before executing tests. The dedicated `db-migrate.yml` workflow handles production deployments and previews independently.

## Rollback

1. Stop the rollout and keep the canary isolated.
2. Revert the application image to the previous release.
3. Restore the database from the pre-release backup when migrations are not backward-compatible.
4. Re-run health, auth, escrow, admin, and webhook validation.
5. Document the failing milestone before reopening rollout.

**Migration rollback procedure:**

Prisma does not support automatic down migrations. To roll back a schema change:

```bash
# 1. Restore from the pre-release database backup
pg_restore -U trustlink -d trustlink_prod backup_pre_release.dump

# 2. Revert to the previous application image and restart
# 3. Verify the application connects and passes health checks

# To mark a failed migration as rolled back in Prisma's migration table:
npx prisma migrate resolve --rolled-back <migration_name>
```

Always take a labelled database snapshot before applying migrations to a shared environment.

