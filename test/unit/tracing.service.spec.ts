import { SpanStatusCode } from '@opentelemetry/api';
import { TracingService } from '../../src/tracing/tracing.service';
import { isTracingEnabled } from '../../src/tracing/tracing.bootstrap';

// Mock the bootstrap guard so the "enabled" branch of withSpan is exercised
// independently of cached module-load state.
jest.mock('../../src/tracing/tracing.bootstrap', () => ({
  isTracingEnabled: jest.fn(),
}));

const mockedIsTracingEnabled = isTracingEnabled as jest.MockedFunction<
  typeof isTracingEnabled
>;

describe('TracingService (issue #79)', () => {
  let tracing: TracingService;

  beforeEach(() => {
    process.env.OTEL_ENABLED = 'false';
    process.env.NODE_ENV = 'development';
    tracing = new TracingService();
    mockedIsTracingEnabled.mockReset();
  });

  afterEach(() => {
    delete process.env.OTEL_ENABLED;
    jest.restoreAllMocks();
  });

  describe('when tracing is disabled', () => {
    beforeEach(() => {
      mockedIsTracingEnabled.mockReturnValue(false);
    });

    it('is disabled when OTEL_ENABLED is false', () => {
      expect(tracing.isEnabled()).toBe(false);
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

  describe('when tracing is enabled (issue #463)', () => {
    type MockSpan = {
      setStatus: jest.Mock;
      recordException: jest.Mock;
      end: jest.Mock;
    };

    let mockSpan: MockSpan;

    // Single source of truth for the cast that lets the test swap the
    // private tracer without leaking implementation details across files.
    const setTracer = (tracer: unknown): void => {
      (tracing as unknown as { tracer: unknown }).tracer = tracer;
    };

    const installSpanMock = (): MockSpan => {
      const span: MockSpan = {
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      };
      setTracer({
        // Stub startActiveSpan so withSpan's async callback is invoked with
        // the mock span. The async callback returns a Promise that we hand
        // back untouched, mirroring the OpenTelemetry contract.
        startActiveSpan: jest.fn(
          (
            _name: string,
            _opts: unknown,
            callback: (s: unknown) => Promise<unknown>,
          ) => callback(span),
        ),
      });
      return span;
    };

    beforeEach(() => {
      mockedIsTracingEnabled.mockReturnValue(true);
      mockSpan = installSpanMock();
    });

    it('withSpan marks the span OK and ends it on success', async () => {
      const result = await tracing.withSpan(
        'test.span',
        { attributes: { 'foo': 'bar' } },
        () => 42,
      );

      expect(result).toBe(42);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
      expect(mockSpan.recordException).not.toHaveBeenCalled();
    });

    it('withSpan records the exception, sets ERROR status, and rethrows the ORIGINAL exception reference', async () => {
      const originalError = new Error('boom');

      let captured: unknown;
      try {
        await tracing.withSpan(
          'test.span',
          {},
          () => {
            throw originalError;
          },
        );
      } catch (err) {
        captured = err;
      }

      // The exact same instance must be rethrown — no wrapping, no mutation.
      expect(captured).toBe(originalError);
      expect(mockSpan.recordException).toHaveBeenCalledWith(originalError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'boom',
      });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('withSpan uses the provided error message for non-Error throws', async () => {
      const stringError = 'string-error';
      const promise = tracing.withSpan('test.span', {}, () => {
        throw stringError;
      });

      await expect(promise).rejects.toBe(stringError);
      expect(mockSpan.recordException).toHaveBeenCalledWith(stringError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: stringError,
      });
    });

    it('withDbSpan wraps synchronously throwing fns in an errored span that rethrows', async () => {
      const dbError = new Error('db failure');
      await expect(
        tracing.withDbSpan('escrow', 'create', () => {
          throw dbError;
        }),
      ).rejects.toBe(dbError);

      expect(mockSpan.recordException).toHaveBeenCalledWith(dbError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: SpanStatusCode.ERROR,
          message: 'db failure',
        }),
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('withDbSpan names the span after the model and operation', async () => {
      await tracing.withDbSpan('escrow', 'findMany', () => []);

      const controller = (
        tracing as unknown as { tracer: { startActiveSpan: jest.Mock } }
      ).tracer;
      const [name, options] = controller.startActiveSpan.mock.calls[0] as [
        string,
        { attributes?: Record<string, unknown> },
      ];
      expect(name).toBe('db.escrow.findMany');
      expect(options.attributes).toEqual(
        expect.objectContaining({
          'db.system': 'postgresql',
          'db.operation': 'findMany',
          'db.sql.table': 'escrow',
        }),
      );
    });

    it('withWorkflowSpan prefixes the span name and forwards attributes', async () => {
      await tracing.withWorkflowSpan(
        'escrow.create',
        () => ({ id: 1 }),
        { 'http.method': 'POST' },
      );

      const controller = (
        tracing as unknown as { tracer: { startActiveSpan: jest.Mock } }
      ).tracer;
      const [name, options] = controller.startActiveSpan.mock.calls[0] as [
        string,
        { attributes?: Record<string, unknown> },
      ];
      expect(name).toBe('workflow.escrow.create');
      expect(options.attributes).toEqual(
        expect.objectContaining({
          'trustlink.workflow': 'escrow.create',
          'http.method': 'POST',
        }),
      );
    });
  });

  describe('isEnabled honors the bootstrap guard', () => {
    it('returns true when bootstrap is enabled', () => {
      mockedIsTracingEnabled.mockReturnValue(true);
      // Re-create to avoid any cached state.
      const svc = new TracingService();
      expect(svc.isEnabled()).toBe(true);
    });

    it('returns false when bootstrap is disabled', () => {
      mockedIsTracingEnabled.mockReturnValue(false);
      const svc = new TracingService();
      expect(svc.isEnabled()).toBe(false);
    });
  });
});
