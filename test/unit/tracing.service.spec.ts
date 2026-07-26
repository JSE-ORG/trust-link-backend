import { TracingService } from '../../src/tracing/tracing.service';

describe('TracingService (issue #79)', () => {
  let tracing: TracingService;

  beforeEach(() => {
    process.env.OTEL_ENABLED = 'false';
    process.env.NODE_ENV = 'development';
    tracing = new TracingService();
  });

  afterEach(() => {
    delete process.env.OTEL_ENABLED;
  });

  it('is disabled when OTEL_ENABLED is false', () => {
    expect(tracing.isEnabled()).toBe(false);
  });

  it('is disabled when OTEL_ENABLED is unset', () => {
    delete process.env.OTEL_ENABLED;
    const svc = new TracingService();
    expect(svc.isEnabled()).toBe(false);
  });

  it('runs fn without span overhead when disabled', async () => {
    const result = await tracing.withDbSpan('escrow', 'findUnique', () => 42);
    expect(result).toBe(42);
  });

  it('runs workflow span when disabled', async () => {
    const result = await tracing.withWorkflowSpan('escrow.get', () => 'ok');
    expect(result).toBe('ok');
  });

  it('returns empty carrier when disabled', () => {
    expect(tracing.injectTraceHeaders()).toEqual({});
  });

  it('returns undefined for active span when disabled', () => {
    expect(tracing.getActiveSpan()).toBeUndefined();
  });

  it('setSpanAttributes does not throw when no active span', () => {
    expect(() =>
      tracing.setSpanAttributes({ 'test.key': 'value' }),
    ).not.toThrow();
  });

  it('returns fn result from withDbSpan when disabled', async () => {
    const fn = jest.fn().mockResolvedValue({ id: 1 });
    const result = await tracing.withDbSpan('escrow', 'findMany', fn);
    expect(result).toEqual({ id: 1 });
    expect(fn).toHaveBeenCalled();
  });

  it('returns fn result from withWorkflowSpan when disabled', async () => {
    const fn = jest.fn().mockReturnValue('workflow-result');
    const result = await tracing.withWorkflowSpan('escrow.create', fn);
    expect(result).toBe('workflow-result');
  });

  it('propagates errors from withDbSpan when disabled', async () => {
    const error = new Error('DB error');
    await expect(
      tracing.withDbSpan('escrow', 'create', () => {
        throw error;
      }),
    ).rejects.toThrow('DB error');
  });

  it('propagates errors from withWorkflowSpan when disabled', async () => {
    const error = new Error('Workflow error');
    await expect(
      tracing.withWorkflowSpan('escrow.create', () => {
        throw error;
      }),
    ).rejects.toThrow('Workflow error');
  });
});
