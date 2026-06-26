# Distributed Tracing (Issue #79)

Trust-Link Backend uses [OpenTelemetry](https://opentelemetry.io/) to trace service request lifecycles across production clusters. Traces flow from inbound HTTP requests through NestJS handlers and database operations, with W3C Trace Context propagation for cross-service correlation.

## Architecture

```
Client / Gateway
      │  traceparent header
      ▼
┌─────────────────────────────────────────┐
│  HTTP auto-instrumentation (Express)    │
│  TracingMiddleware (workflow metadata)  │
│  TracingInterceptor (handler spans)     │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  PrismaService (db.* spans per op)      │
│  Redis / outbound HTTP (auto-instr.)    │
└─────────────────┬───────────────────────┘
                  │ OTLP HTTP
                  ▼
         Jaeger / Tempo / Datadog
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_ENABLED` | `true` | Set to `false` to disable tracing |
| `OTEL_SERVICE_NAME` | `trustlink-backend` | Service name in trace backend |
| `OTEL_SERVICE_VERSION` | `1.0.0` | Service version attribute |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(none)_ | OTLP collector base URL (e.g. `http://jaeger:4318`) |

Tracing is automatically disabled when `NODE_ENV=test`.

## Local Development

Start the stack with Jaeger included:

```bash
docker compose up -d
```

Open the Jaeger UI at [http://localhost:16686](http://localhost:16686) and search for service `trustlink-backend`.

## Span Types

| Span name pattern | Description |
|-------------------|-------------|
| `GET /escrow/...` | HTTP span (auto-instrumentation) |
| `workflow.escrow.get` | API workflow span (grouped by route family) |
| `handler.EscrowController.findOne` | NestJS handler span |
| `db.escrow.findUnique` | Database operation with duration |

### Database attributes

Every `db.*` span includes:

- `db.system`: `postgresql`
- `db.operation`: e.g. `findUnique`, `create`, `update`
- `db.sql.table`: model name (`escrow`, `dispute`, etc.)

## Distributed Context

Incoming requests with a `traceparent` header continue the parent trace. Outbound calls can inject context via `TracingService.injectTraceHeaders()`.

## Production Clusters

1. Deploy an OTLP-compatible collector (Jaeger, Grafana Tempo, Datadog Agent, AWS ADOT).
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector's OTLP HTTP endpoint.
3. Ensure pod/service name via `OTEL_SERVICE_NAME`.
4. Correlate traces with structured JSON logs using the `trace_id` field when log-trace correlation is enabled in your log stack.

## Key Source Files

| File | Role |
|------|------|
| `src/tracing/tracing.bootstrap.ts` | SDK initialization (imported first in `main.ts`) |
| `src/tracing/tracing.service.ts` | Span helpers |
| `src/tracing/tracing.middleware.ts` | Workflow metadata on HTTP spans |
| `src/tracing/tracing.interceptor.ts` | Per-handler workflow spans |
| `src/tracing/prisma-tracing.wrapper.ts` | Database operation spans |
