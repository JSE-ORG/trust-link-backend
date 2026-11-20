# Production Deployment Guide

## Overview

This guide defines the production deployment order for the Trust-Link backend. Use it for staging and production releases so infrastructure, database migrations, service rollout, and validation happen in a consistent sequence.

## Infrastructure Prerequisites

- Node.js 22 runtime (the version pinned by `.nvmrc` and both Docker stages).
- PostgreSQL 16 (the version used by Docker Compose and CI).
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
- `ACCESS_TOKEN_TTL` *(optional)* — lifetime of SEP-10 access (JWT) tokens in seconds; default: `3600` (1 hour)
- `SYSTEM_SIGNER_SECRET` — Stellar secret key used for transaction signing
- `ADMIN_ADDRESS`
- `ADMIN_NOTIFICATION_EMAIL` *(optional)* — email address for administrative dispute alert notifications; default: none (if unset, admin dispute alerts are skipped with a warning)
- `STELLAR_NETWORK`
- `STELLAR_WEBHOOK_SECRET` — required in production; validates inbound Stellar webhook payloads
- `WEBHOOK_EVENT_RETENTION_DAYS` *(optional)* — retention window in days for processed Stellar webhook event records pruned by daily cleanup; default: `30`
- `REDIS_URL`
- `ALLOWED_ORIGINS`
- `API_BASE_URL`
- `PRESIGN_SECRET` — signs evidence pre-signed URLs; must be stable across restarts and replicas
- `CONTRACT_ID` — Soroban escrow contract ID
- `FRONTEND_URL` — required in production
- `EVIDENCE_STORAGE_BASE_URL` — public base URL evidence objects are served from
- `CONTACT_ENCRYPTION_KEY` — 64-character hex string (32 bytes); required in production
- `CREDENTIAL_ENCRYPTION_KEY` — 64-character hex string (32 bytes); required in production
- `SOROBAN_RPC_URL` — required in production; no safe default RPC endpoint exists
- `SOROBAN_POLL_INTERVAL_MS` *(optional)* — poll cadence in milliseconds for the Soroban event poller; default: `5000` (must be greater than `SOROBAN_RPC_TIMEOUT_MS`)
- `SOROBAN_RPC_TIMEOUT_MS` *(optional)* — per-request timeout in milliseconds for Soroban RPC calls; default: `4000` (the application fails to boot unless this is strictly less than `SOROBAN_POLL_INTERVAL_MS`)
- `SENTRY_DSN` — required in production; error reporting endpoint URL
- `GIT_SHA` *(optional)* — git commit SHA of the deployed build; tags Sentry releases and is included in `GET /version` (omitted when unset); default: none
- `SENDGRID_API_KEY` *(optional)* — enable email notifications
- `SENDGRID_FROM_EMAIL` — **required when `SENDGRID_API_KEY` is set**; verified sender address
- `TWILIO_ACCOUNT_SID` *(optional)* — enable SMS notifications
- `TWILIO_AUTH_TOKEN` — required when `TWILIO_ACCOUNT_SID` is set
- `TWILIO_FROM_NUMBER` — **required when `TWILIO_ACCOUNT_SID` is set**; E.164 format
- `OTEL_ENABLED`
- `OTEL_EXPORTER_OTLP_ENDPOINT`

Keep secrets in the deployment platform secret manager. Do not bake them into images, workflow files, or migration scripts.

## OpenAPI schema

Swagger UI is intentionally disabled when `NODE_ENV=production`. Production
operators and API consumers should obtain the generated schema from the CI
OpenAPI artifact or run `npm run openapi:generate` against the release source.

## Docker Compose Production Deployment

The `docker-compose.yml` includes a production profile optimized for production deployments. To use the production profile:

### Prerequisites

1. Create a `.env` file with production secrets:
   ```bash
   SEP10_JWT_SECRET=your-production-jwt-secret-at-least-32-chars
   SYSTEM_SIGNER_SECRET=Sxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ADMIN_ADDRESS=Gxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   POSTGRES_PASSWORD=your-secure-postgres-password
   PRESIGN_SECRET=your-cryptographically-random-presign-secret
   CONTRACT_ID=your-soroban-contract-id
   FRONTEND_URL=https://app.yourdomain.com
   EVIDENCE_STORAGE_BASE_URL=https://storage.yourdomain.com
   CONTACT_ENCRYPTION_KEY=64-character-hex-string-for-contact-encryption
   CREDENTIAL_ENCRYPTION_KEY=64-character-hex-string-for-credential-encryption
   STELLAR_NETWORK=MAINNET
   STELLAR_WEBHOOK_SECRET=your-stellar-webhook-secret
   SENTRY_DSN=https://xxxx@sentry.io/yyyy
   SOROBAN_RPC_URL=https://your-soroban-rpc-endpoint
   ALLOWED_ORIGINS=https://app.yourdomain.com
   API_BASE_URL=https://api.yourdomain.com
   OTEL_ENABLED=false
   OTEL_EXPORTER_OTLP_ENDPOINT=
   # Optional — enable email notifications
   # SENDGRID_API_KEY=SG.xxxx
   # SENDGRID_FROM_EMAIL=noreply@yourdomain.com
   # Optional — enable SMS notifications
   # TWILIO_ACCOUNT_SID=ACxxxx
   # TWILIO_AUTH_TOKEN=xxxx
   # TWILIO_FROM_NUMBER=+15550001234
   ```

2. Generate 64-character hex keys for `CONTACT_ENCRYPTION_KEY` and `CREDENTIAL_ENCRYPTION_KEY` with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### Starting Production Services

```bash
# Start with production profile
docker-compose --profile production up -d

# View logs
docker-compose --profile production logs -f

# Stop services
docker-compose --profile production down
```

### Production Profile Features

- **Restart Policy**: `restart: always` for automatic recovery
- **Resource Limits**: CPU and memory limits for each service
- **Logging**: JSON-file driver with log rotation (10MB max, 3 files)
- **Health Checks**: All services include health checks with proper dependency ordering
- **No Development Mounts**: Source code volume mounts removed for security
- **Non-root User**: Application runs as `nestjs` user (UID 1001)

### Service Health Checks

- **PostgreSQL**: Uses `pg_isready` to verify database connectivity
- **Redis**: Uses `redis-cli ping` to verify Redis is responding
- **Application**: Uses three HTTP endpoints — pick the right one for each job:

| Endpoint          | Semantics    | When to use                                                                                                |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `GET /health/live`| **Liveness** | Kubernetes/container-orchestrator `livenessProbe`. Always returns 200 if the HTTP stack is up; NO dependency checks. A failure here means "restart the container". Never triggers a restart because an upstream dependency is briefly down. |
| `GET /health/ready` | **Readiness** | Kubernetes/container-orchestrator `readinessProbe` and load-balancer target-group health. Runs full dependency checks (PostgreSQL + Horizon, Redis reported but optional). Returns 503 when required dependencies are unreachable, so the instance is removed from rotation temporarily. |
| `GET /health`    | **Legacy**   | Alias for `/health/ready` (readiness semantics). Preserved for backwards compatibility with existing monitors; new deployments should prefer the two endpoints above. |

#### Orchestrator example (Kubernetes probes)

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

Load balancers (AWS ALB, GCP LB, nginx, etc.) should poll **`/health/ready`** (not `/health/live`) so an instance with a database outage is taken out of the pool instead of returning 5xx to real users.

### Client IP Behind a Load Balancer

Behind a load balancer, `req.ip` is the balancer's address, so every user shares one rate-limit bucket. Set `TRUST_PROXY` so the app reads the real client address from `X-Forwarded-For`:

- `TRUST_PROXY=1` when exactly one proxy sits in front of the app (the common case).
- A comma-separated list of addresses or CIDR ranges, such as `10.0.0.0/8`, when the proxy addresses are known.

Leave it unset when no proxy is in front of the app. Trusting `X-Forwarded-For` without a proxy lets any client choose its own IP.

The application service waits for both PostgreSQL and Redis to be healthy before starting, preventing crash-loops due to unavailable dependencies.

### Resource Limits

Production services have the following resource limits:

- **app-prod**: 1 CPU, 1GB memory (reserve: 0.5 CPU, 512MB)
- **db-prod**: 1 CPU, 1GB memory (reserve: 0.5 CPU, 512MB)
- **redis-prod**: 0.5 CPU, 512MB memory (reserve: 0.25 CPU, 256MB)

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
- `GET /health/live` returns 200 (always, no dependencies touched).
- `GET /health/ready` returns 200 once database + Horizon are reachable; returns 503 when required dependencies are unavailable.
- `GET /health` (legacy alias) returns the same status code and body as `GET /health/ready`.
- `GET /version` returns the expected release version.
- SEP-10 challenge and verify flows issue tokens.
- Vendor escrow list queries return within the expected latency budget.
- Admin endpoints return 403 for vendor tokens and 200 for admin tokens.
- `PATCH /admin/dispute/:id/resolve` is reachable only by admin JWTs.
- Webhook signature validation rejects missing or invalid signatures.
- Queue dashboard and logs show no failed background jobs.
- Error rate and p95 latency remain stable for at least one canary window.

## Production Baseline Migration

The `20260526000000_initial` baseline migration creates the foundational tables (`Escrow`, `VendorProfile`, `Dispute`, `Notification`) and enums. All statements are idempotent (`IF NOT EXISTS`), making them safe on any database.

**If your production database was originally set up via `prisma db push`** (no `_prisma_migrations` table), you must run this one-time transition before the baseline is applied:

```bash
bash scripts/resolve-existing-migrations.sh
```

This script syncs the schema and marks all 14 existing migrations as applied, so subsequent `prisma migrate deploy` runs only apply new changes.

**If your production database already uses Prisma Migrate** (has `_prisma_migrations` records), no action is needed — the baseline migration is a no-op via `IF NOT EXISTS`.

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


## Image revision and container probes

CI passes the checked-out Git commit SHA to Docker with `--build-arg GIT_SHA=<sha>` and the production stage exposes it as `GIT_SHA`. Verify `GET /version` reports the matching `commit` value. For local builds, use `docker build --build-arg GIT_SHA=abc -t trustlink-backend:test .` and check the `/version` response from a running container.

The Dockerfile and both Compose application services use `GET /health/live` as their **container liveness** check. Configure ingress and load balancers to use `GET /health/ready` for **readiness**. A dependency outage must not restart an otherwise healthy process.

## Configuration variable reference (from `src/config/config.schema.ts`)

The following table lists all environment variables validated by `configValidationSchema`, including their default value, whether they are required in production, and a one-line description derived from the schema. Conditions such as "required when X is set" or "required when STELLAR_NETWORK is MAINNET" apply in all environments unless noted.

| Variable | Default | Required in production | Description |
|---|---|---|---|
| `PORT` | `3000` | No | Port the HTTP server listens on. |
| `API_BASE_URL` | `http://localhost:3000` | No | Base URL for internal HTTP calls. |
| `FRONTEND_URL` | `http://localhost:3000` | Yes | Public frontend origin used in customer-facing payment links. |
| `EVIDENCE_STORAGE_BASE_URL` | `http://localhost:9000` | Yes | Public base URL evidence objects are served from. |
| `DATABASE_URL` | `—` | Yes (always required) | PostgreSQL connection string. |
| `CONTACT_ENCRYPTION_KEY` | `—` | Yes (optional otherwise) | 64-character hex key (32 bytes) for encrypting contact data. |
| `CREDENTIAL_ENCRYPTION_KEY` | `—` | Yes (optional otherwise) | 64-character hex key (32 bytes) for encrypting credentials. |
| `SEP10_JWT_SECRET` | `—` | Yes (always required) | Secret used to sign SEP-10 JWT tokens; minimum 32 characters. |
| `PRESIGN_SECRET` | `—` | Yes (always required) | HMAC secret for signing evidence pre-signed URLs; must be stable across restarts/replicas. |
| `SYSTEM_SIGNER_SECRET` | `—` | Yes (always required) | Stellar secret key used to sign contract transactions (checksum-validated). |
| `SEP10_SIGNING_SECRET` | `— (falls back to SYSTEM_SIGNER_SECRET)` | No | Stellar secret key for signing SEP-10 challenges; keep stable and identical across replicas when set. |
| `CONTRACT_ID` | `—` | Yes (always required) | Soroban escrow contract identifier/address used for contract calls. |
| `ADMIN_ADDRESS` | `—` | Yes (always required) | Stellar public key of the platform admin account. |
| `ADMIN_NOTIFICATION_EMAIL` | `—` | No | Email address for administrative dispute alert notifications; alerts are skipped if unset. |
| `AUTO_RELEASE_SOURCE_ADDRESS` | `—` | No | Stellar public key of the auto-release signing account; required to use the admin DLQ replay endpoint. |
| `NODE_ENV` | `development` | No | Runtime environment (`development` \| `production` \| `test`). |
| `SENDGRID_API_KEY` | `—` | No | SendGrid API key; enables email notifications when set. |
| `SENDGRID_FROM_EMAIL` | `—` | Yes when SENDGRID_API_KEY is set | Verified sender email address used for outbound SendGrid emails. |
| `SENDGRID_TEMPLATE_FUNDED` | `—` | Yes (always required) | SendGrid dynamic template id for funded notifications (`d-` + 32 hex chars). |
| `SENDGRID_TEMPLATE_SHIPPED` | `—` | Yes (always required) | SendGrid dynamic template id for shipped notifications. |
| `SENDGRID_TEMPLATE_DELIVERED` | `—` | Yes (always required) | SendGrid dynamic template id for delivered notifications. |
| `SENDGRID_TEMPLATE_DISPUTED` | `—` | Yes (always required) | SendGrid dynamic template id for disputed notifications. |
| `SENDGRID_TEMPLATE_COMPLETED` | `—` | Yes (always required) | SendGrid dynamic template id for completed notifications. |
| `SENDGRID_TEMPLATE_REFUNDED` | `—` | Yes (always required) | SendGrid dynamic template id for refunded notifications. |
| `TWILIO_ACCOUNT_SID` | `—` | No | Twilio account SID; enables SMS notifications when set. |
| `TWILIO_AUTH_TOKEN` | `—` | Yes when TWILIO_ACCOUNT_SID is set (schema requires presence of related values) | Twilio auth token. |
| `TWILIO_FROM_NUMBER` | `—` | Yes when TWILIO_ACCOUNT_SID is set | Twilio sender number in E.164 format. |
| `STELLAR_NETWORK` | `TESTNET` | No | Target Stellar network (`TESTNET` \| `MAINNET`). |
| `ALLOWED_ORIGINS` | `—` | No (should be set in production) | Comma-separated list of allowed CORS origins. |
| `CSP_CONNECT_SRC` | `—` | No | Additional CSP `connect-src` origins allowed by the browser. |
| `STELLAR_WEBHOOK_SECRET` | `—` | Yes | HMAC secret for verifying inbound Stellar webhook payloads. |
| `LOG_LEVEL` | `info` | No | Application log level (`trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`). |
| `REDIS_URL` | `—` | No | Redis connection URL for caching; caching disabled when unset. |
| `ESCROW_CACHE_TTL_SECONDS` | `60` | No | Cache TTL for `GET /escrow/:id`, 1 to 60 seconds. Writes invalidate the entry immediately. |
| `DB_POOL_CONNECTION_LIMIT` | `10` | No | Maximum number of Prisma/PostgreSQL pool connections. |
| `DB_POOL_TIMEOUT_MS` | `10000` | No | Milliseconds to wait for a free database connection before timing out. |
| `OTEL_ENABLED` | `true` | No | Enables OpenTelemetry tracing (`"true"` \| `"false"`). |
| `OTEL_SERVICE_NAME` | `trustlink-backend` | No | OpenTelemetry service name. |
| `OTEL_SERVICE_VERSION` | `1.0.0` | No | OpenTelemetry service version. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `—` | No (set when OTEL is enabled in production) | OTLP HTTP endpoint for exporting traces. |
| `SENTRY_DSN` | `—` | Yes (empty allowed outside production) | Sentry DSN for error reporting. |
| `GIT_SHA` | `—` | No | Git commit SHA of the deployed build; used for Sentry release tagging and `/version`. |
| `TRUST_PROXY` | `—` | No | Express trusted proxy setting for correct client IP/rate limiting behind proxies/load balancers. |
| `AUTH_CHALLENGE_LIMIT` | `10` | No | Maximum requests per window to each `/auth` route (challenge, verify, refresh). |
| `AUTH_CHALLENGE_WINDOW` | `60000` | No | Auth challenge/verify/refresh rate-limit window in milliseconds. |
| `PUBLIC_LIMIT` | `60` | No | Maximum requests per window for public/non-auth routes. |
| `PUBLIC_WINDOW` | `60000` | No | Public route rate-limit window in milliseconds. |
| `EVIDENCE_UPLOAD_LIMIT` | `10` | No | Maximum evidence upload requests per rate-limit window. |
| `EVIDENCE_UPLOAD_TTL` | `60000` | No | Evidence upload rate-limit window in milliseconds. |
| `REFRESH_TOKEN_TTL` | `604800` | No | Refresh token lifetime in seconds (default 7 days). |
| `ACCESS_TOKEN_TTL` | `3600` | No | SEP-10 access (JWT) token lifetime in seconds (max 86400). |
| `LOGISTICS_API_BASE_URL` | `—` | No | Base URL for the external logistics/tracking API integration. |
| `LOGISTICS_API_KEY` | `—` | No | API key for the external logistics/tracking API integration. |
| `TERMINAL_AFRICA_API_BASE_URL` | `—` | No | Base URL of the Terminal Africa API. Optional second logistics provider; GIGL stays active. |
| `TERMINAL_AFRICA_API_KEY` | `—` | No | Terminal Africa secret key. Both Terminal Africa keys must be set to enable its client. |
| `STELLAR_HORIZON_URL` | `—` | No | Stellar Horizon base URL override. |
| `QUERY_TIMEOUT_MS` | `30000` | No | Maximum Prisma query runtime in milliseconds before cancellation. |
| `SLOW_QUERY_THRESHOLD_MS` | `500` | No | Threshold in milliseconds above which slow queries are logged (0 disables). |
| `SOROBAN_RPC_URL` | `—` | Yes (and required when STELLAR_NETWORK is MAINNET) | Soroban RPC endpoint for on-chain event polling; must match `STELLAR_NETWORK`. |
| `SOROBAN_POLLER_ENABLED` | `true` | No | Enables the Soroban event polling interval on module init. |
| `SOROBAN_POLL_INTERVAL_MS` | `5000` | No | Soroban poll cadence in milliseconds (>= 1000). |
| `SOROBAN_RPC_TIMEOUT_MS` | `4000` | No | Per-request timeout in milliseconds for Soroban RPC calls; must be less than `SOROBAN_POLL_INTERVAL_MS`. |
| `SOROBAN_START_LEDGER` | `—` | No | Optional starting ledger for Soroban polling when no cursor is stored (must be within node retention). |
| `WEBHOOK_EVENT_RETENTION_DAYS` | `30` | No | Retention window in days for processed Stellar webhook event records before daily pruning. |

_Notes: "Yes (always required)" means the schema requires the value regardless of `NODE_ENV`. Some keys are conditionally required based on other variables (e.g. `SENDGRID_FROM_EMAIL` when `SENDGRID_API_KEY` is set, `TWILIO_FROM_NUMBER`/`TWILIO_AUTH_TOKEN` when `TWILIO_ACCOUNT_SID` is set, `SOROBAN_RPC_URL` when `STELLAR_NETWORK` is `MAINNET`)._
