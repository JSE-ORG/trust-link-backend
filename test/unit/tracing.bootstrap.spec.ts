import { isTracingEnabled } from '../../src/tracing/tracing.bootstrap';

describe('tracing.bootstrap', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    process.env.OTEL_ENABLED = 'true';
    expect(isTracingEnabled()).toBe(false);
  });

  it('returns false when OTEL_ENABLED is false', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTEL_ENABLED = 'false';
    expect(isTracingEnabled()).toBe(false);
  });

  it('returns false when OTEL_ENABLED is unset and NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.OTEL_ENABLED;
    expect(isTracingEnabled()).toBe(false);
  });
});
