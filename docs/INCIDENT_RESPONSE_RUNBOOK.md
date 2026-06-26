# Incident Response Runbook

This runbook provides step-by-step procedures for restoring Trust-Link Backend during production incidents. Steps are validated against the `docker-compose.yml` stack (PostgreSQL 15, Redis 7, NestJS app).

## Severity Levels

| Level | Definition | Response target |
|-------|------------|-----------------|
| **SEV-1** | Complete outage; escrow funds at risk | Immediate (all hands) |
| **SEV-2** | Major feature degraded; no data loss | < 1 hour |
| **SEV-3** | Minor degradation; workaround exists | < 4 hours |
| **SEV-4** | Cosmetic / low impact | Next business day |

## Point of Contact — Critical Dependencies

| Dependency | Role | Contact | Escalation |
|------------|------|---------|------------|
| **Trust-Link On-Call** | Primary incident owner | oncall@trust-link.io | PagerDuty rotation |
| **Trust-Link Engineering Lead** | Technical decisions | engineering@trust-link.io | Secondary on-call |
| **PostgreSQL (self-hosted)** | Primary data store | dba@trust-link.io | Restore from backup |
| **Redis** | Response cache | platform@trust-link.io | Cache flush acceptable |
| **Stellar Horizon** | Blockchain events / webhooks | [Stellar Status](https://status.stellar.org/) | Switch `STELLAR_HORIZON_URL` to fallback node |
| **Stellar Network** | Settlement layer | [Stellar Discord #dev](https://discord.gg/stellar) | Network-wide; no local fix |
| **SendGrid** | Email notifications | support@sendgrid.com | Disable email; use SMS |
| **Twilio** | SMS notifications | support@twilio.com | Disable SMS; use email |
| **Container Registry** | Docker images | platform@trust-link.io | Re-deploy last known good tag |

> Update contact emails before production launch. Store secrets in your team's vault, not in this document.

---

## 1. Initial Triage

### 1.1 Confirm the incident

```bash
curl -s http://localhost:3000/health | jq .
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "<ISO-8601>",
  "environment": "production",
  "version": "1.0.0"
}
```

If `status` is not `ok` or the request times out, proceed to container recovery.

### 1.2 Check container status

```bash
docker compose ps
```

All services (`app`, `db`, `redis`, `jaeger`) should show `running` or `healthy`.

### 1.3 Collect logs

```bash
docker compose logs app --tail=200
docker compose logs db --tail=50
docker compose logs redis --tail=50
```

Look for `level: "error"` JSON lines and stack traces.

### 1.4 Inspect distributed traces

If Jaeger is running (local/staging):

1. Open [http://localhost:16686](http://localhost:16686)
2. Select service `trustlink-backend`
3. Filter by `error=true` or high-latency spans (`db.*`, `workflow.*`)

See `docs/TRACING.md` for production collector configuration.

---

## 2. Container Recovery

### 2.1 Restart a single service

```bash
docker compose restart app
```

Wait 10 seconds, then verify health:

```bash
curl -s http://localhost:3000/health
```

### 2.2 Rebuild and redeploy the application container

Use when the application image is corrupt or after a bad deploy:

```bash
docker compose build app --no-cache
docker compose up -d app
```

### 2.3 Full stack restart

When multiple services are unhealthy:

```bash
docker compose down
docker compose up -d
```

Verify all services:

```bash
docker compose ps
curl -s http://localhost:3000/health
```

### 2.4 Roll back to a previous image tag

In production (replace `<tag>` with last known good version):

```bash
docker pull <registry>/trustlink-backend:<tag>
docker compose up -d app
```

---

## 3. Database Backup & Restoration

### 3.1 Create an on-demand backup

Run from the host (PostgreSQL container name may vary; default is `trust-link-backend-db-1`):

```bash
docker compose exec db pg_dump -U trustlink -d trustlink_db -Fc -f /tmp/trustlink_backup.dump
docker compose cp db:/tmp/trustlink_backup.dump ./backups/trustlink_$(date +%Y%m%d_%H%M%S).dump
```

Ensure the `backups/` directory exists:

```bash
mkdir -p backups
```

### 3.2 Restore from backup

**Warning:** This replaces all data in `trustlink_db`. Stop the app first to prevent writes during restore.

```bash
docker compose stop app
```

Copy the backup into the database container:

```bash
docker compose cp ./backups/trustlink_YYYYMMDD_HHMMSS.dump db:/tmp/restore.dump
```

Drop and recreate the database, then restore:

```bash
docker compose exec db psql -U trustlink -c "DROP DATABASE IF EXISTS trustlink_db;"
docker compose exec db psql -U trustlink -c "CREATE DATABASE trustlink_db;"
docker compose exec db pg_restore -U trustlink -d trustlink_db /tmp/restore.dump
```

Restart the application:

```bash
docker compose start app
curl -s http://localhost:3000/health
```

### 3.3 Run pending migrations after restore

If the backup is from an older schema version:

```bash
docker compose exec app npx prisma migrate deploy
```

---

## 4. Redis Recovery

Redis holds non-critical response caches. A flush is safe during incidents.

### 4.1 Restart Redis

```bash
docker compose restart redis
```

### 4.2 Flush cache (cache poisoning or stale data)

```bash
docker compose exec redis redis-cli FLUSHALL
```

The application continues serving requests; cache misses fall through to PostgreSQL.

---

## 5. Debugging Playbook

### 5.1 Database connectivity

```bash
docker compose exec db psql -U trustlink -d trustlink_db -c "SELECT 1;"
```

If this fails, check `DATABASE_URL` in the app environment matches compose credentials:

```
postgresql://trustlink:trustlink@db:5432/trustlink_db
```

### 5.2 Authentication failures (SEP-10)

- Verify `SEP10_JWT_SECRET` is at least 32 characters and identical across all app replicas
- Check `ADMIN_ADDRESS` is a valid Stellar public key
- Review logs for `401` responses on protected routes

### 5.3 Webhook delivery failures

- Confirm `STELLAR_WEBHOOK_SECRET` matches Horizon callback configuration
- Check `POST /webhooks/stellar` traces in Jaeger for `workflow.webhook.stellar`
- Inspect `processedWebhookEvent` table for duplicate operation IDs

### 5.4 High latency

1. Open Jaeger → filter spans `db.*` with duration > 500ms
2. Check Redis: `docker compose exec redis redis-cli PING`
3. Review rate-limit logs for throttling (`429` responses)

### 5.5 Enable debug logging temporarily

```bash
docker compose exec app sh -c 'export LOG_LEVEL=debug && node dist/main.js'
```

Or set `LOG_LEVEL=debug` in compose environment and restart `app`.

---

## 6. Post-Incident

1. Document timeline, root cause, and remediation in the incident ticket
2. Update `CHANGELOG.md` if a patch release is shipped
3. Schedule a blameless post-mortem for SEV-1/SEV-2 incidents
4. Verify backups are current (automate daily `pg_dump` in production)

---

## Quick Reference Card

| Symptom | First action |
|---------|--------------|
| App not responding | `docker compose restart app` → check `/health` |
| Database errors | `docker compose restart db` → test `psql SELECT 1` |
| Stale/wrong data | Restore from `backups/*.dump` (Section 3.2) |
| Cache issues | `redis-cli FLUSHALL` |
| Bad deploy | Roll back image tag (Section 2.4) |
| Need trace data | Jaeger UI :16686 or production OTLP collector |
