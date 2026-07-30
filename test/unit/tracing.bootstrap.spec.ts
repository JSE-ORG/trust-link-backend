jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn(),
  })),
}));

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn(),
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn().mockReturnValue([]),
}));

jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: jest.fn().mockReturnValue({}),
}));

jest.mock('@opentelemetry/core', () => ({
  W3CTraceContextPropagator: jest.fn(),
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
}));

import { NodeSDK } from '@opentelemetry/sdk-node';

describe('tracing.bootstrap', () => {
  const originalEnv = process.env;

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_SERVICE_VERSION;
    process.env.NODE_ENV = 'test';
  });

  function loadBootstrap() {
    jest.isolateModules(() => {
      require('../../src/tracing/tracing.bootstrap');
    });
  }

  function loadBootstrapAndGetIsEnabled(): boolean {
    let result: boolean;
    jest.isolateModules(() => {
      const { isTracingEnabled } = require('../../src/tracing/tracing.bootstrap');
      result = isTracingEnabled();
    });
    return result;
  }

  it('returns false when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    process.env.OTEL_ENABLED = 'true';
    expect(loadBootstrapAndGetIsEnabled()).toBe(false);
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('returns false when OTEL_ENABLED is false', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = 'false';
    expect(loadBootstrapAndGetIsEnabled()).toBe(false);
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('returns false when OTEL_ENABLED is unset and NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    expect(loadBootstrapAndGetIsEnabled()).toBe(false);
  });

  it('returns true when NODE_ENV is not test and OTEL_ENABLED is set', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = 'true';
    expect(loadBootstrapAndGetIsEnabled()).toBe(true);
    expect(NodeSDK).toHaveBeenCalled();
  });

  it('returns true when OTEL_ENABLED is empty string and NODE_ENV is not test', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = '';
    expect(loadBootstrapAndGetIsEnabled()).toBe(true);
  });

  it('does not throw when no OTEL exporter endpoint exists', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = 'true';
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    expect(() => {
      loadBootstrap();
    }).not.toThrow();

    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        traceExporter: undefined,
      }),
    );
  });

  it('does not throw when OTEL exporter endpoint is configured', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';

    expect(() => {
      loadBootstrap();
    }).not.toThrow();

    expect(NodeSDK).toHaveBeenCalled();
  });

  it('skips exporter initialization when tracing is disabled', () => {
    process.env.NODE_ENV = 'test';
    process.env.OTEL_ENABLED = 'true';

    expect(() => {
      loadBootstrap();
    }).not.toThrow();

    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('uses default service name and version when env vars are unset', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = 'true';

    loadBootstrap();

    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.anything(),
        traceExporter: undefined,
        instrumentations: expect.any(Array),
      }),
    );
  });
});
