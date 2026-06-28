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
- `CREDENTIAL_ENCRYPTION_KEY` (64-character hex string for logistics API key encryption)

Keep secrets in the deployment platform secret manager. Do not bake them into images, workflow files, or migration scripts.

## Docker Compose Production Deployment

The `docker-compose.yml` includes a production profile optimized for production deployments. To use the production profile:

### Prerequisites

1. Create a `.env` file with production secrets:
   ```bash
   SEP10_JWT_SECRET=your-production-jwt-secret-at-least-32-chars
   ADMIN_ADDRESS=your-admin-stellar-address
   POSTGRES_PASSWORD=your-secure-postgres-password
   CREDENTIAL_ENCRYPTION_KEY=64-character-hex-string-for-encryption
   OTEL_ENABLED=false
   OTEL_EXPORTER_OTLP_ENDPOINT=
   ```

2. Ensure the `CREDENTIAL_ENCRYPTION_KEY` is exactly 64 hex characters (32 bytes). Generate one with:
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
- **Application**: Uses `/health` endpoint to verify all dependencies are healthy

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
- `GET /health` returns a successful response.
- `GET /version` returns the expected release version.
- SEP-10 challenge and verify flows issue tokens.
- Vendor escrow list queries return within the expected latency budget.
- Admin endpoints return 403 for vendor tokens and 200 for admin tokens.
- `PATCH /admin/dispute/:id/resolve` is reachable only by admin JWTs.
- Webhook signature validation rejects missing or invalid signatures.
- Queue dashboard and logs show no failed background jobs.
- Error rate and p95 latency remain stable for at least one canary window.

## Rollback

1. Stop the rollout and keep the canary isolated.
2. Revert the application image to the previous release.
3. Restore the database from the pre-release backup when migrations are not backward-compatible.
4. Re-run health, auth, escrow, admin, and webhook validation.
5. Document the failing milestone before reopening rollout.

