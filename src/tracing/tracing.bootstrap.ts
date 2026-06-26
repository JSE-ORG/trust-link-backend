/**
 * Issue #79 – OpenTelemetry bootstrap.
 *
 * Must be imported before any other application modules (see main.ts) so
 * auto-instrumentation hooks Express/HTTP before the server starts.
 */
import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const isTest = process.env.NODE_ENV === 'test';
const isEnabled = !isTest && process.env.OTEL_ENABLED !== 'false';

let sdk: NodeSDK | undefined;

if (isEnabled) {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'trustlink-backend';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION ?? '1.0.0';
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(
    /\/$/,
    '',
  );

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: otlpEndpoint
      ? new OTLPTraceExporter({
          url: `${otlpEndpoint}/v1/traces`,
        })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = (): void => {
    void sdk?.shutdown();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export function isTracingEnabled(): boolean {
  return isEnabled;
}
