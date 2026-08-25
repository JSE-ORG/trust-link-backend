import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from '@opentelemetry/api';

jest.mock('@opentelemetry/api', () => ({
  context: {
    active: jest.fn(() => ({})),
  },
  propagation: {
    inject: jest.fn(),
  },
  SpanKind: { INTERNAL: 0, CLIENT: 1 },
  SpanStatusCode: { OK: 1, ERROR: 2 },
  trace: {
    getTracer: jest.fn(),
    getActiveSpan: jest.fn(),
  },
}));

jest.mock('./tracing.bootstrap', () => ({
  isTracingEnabled: jest.fn(() => false),
}));

import { TracingService } from './tracing.service';
import { isTracingEnabled } from './tracing.bootstrap';

describe('TracingService', () => {
  let service: TracingService;
  let mockTracer: jest.Mocked<ReturnType<typeof trace.getTracer>>;
  let mockSpan: Partial<Span>;

  beforeEach(() => {
    jest.clearAllMocks();
    (trace.getActiveSpan as jest.Mock).mockReturnValue(undefined);

    mockSpan = {
      setStatus: jest.fn(),
      recordException: jest.fn(),
      setAttributes: jest.fn(),
      end: jest.fn(),
    };

    mockTracer = {
      startActiveSpan: jest.fn().mockImplementation((_name, _options, fn) => {
        return fn(mockSpan);
      }),
    } as unknown as jest.Mocked<ReturnType<typeof trace.getTracer>>;

    (trace.getTracer as jest.Mock).mockReturnValue(mockTracer);
    service = new TracingService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('returns false when OTEL_ENABLED is undefined', () => {
      (isTracingEnabled as jest.Mock).mockReturnValue(false);
      expect(service.isEnabled()).toBe(false);
    });

    it('returns false when OTEL_ENABLED is empty string', () => {
      (isTracingEnabled as jest.Mock).mockReturnValue(false);
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when OTEL_ENABLED is set', () => {
      (isTracingEnabled as jest.Mock).mockReturnValue(true);
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('getActiveSpan', () => {
    it('returns undefined when no active span exists', () => {
      (trace.getActiveSpan as jest.Mock).mockReturnValue(undefined);
      expect(service.getActiveSpan()).toBeUndefined();
    });

    it('returns the active span when one exists', () => {
      const activeSpan = { setAttributes: jest.fn() } as unknown as Span;
      (trace.getActiveSpan as jest.Mock).mockReturnValue(activeSpan);
      expect(service.getActiveSpan()).toBe(activeSpan);
    });
  });

  describe('injectTraceHeaders', () => {
    it('injects trace context into the provided carrier', () => {
      const carrier: Record<string, string> = {};
      (propagation.inject as jest.Mock).mockImplementation(() => {});

      const result = service.injectTraceHeaders(carrier);

      expect(propagation.inject).toHaveBeenCalledWith(
        context.active(),
        carrier,
      );
      expect(result).toBe(carrier);
    });

    it('returns the same carrier object passed in', () => {
      const carrier: Record<string, string> = {};
      (propagation.inject as jest.Mock).mockImplementation(() => {});

      const result = service.injectTraceHeaders(carrier);
      expect(result).toBe(carrier);
    });
  });

  describe('withSpan - disabled path', () => {
    beforeEach(() => {
      (isTracingEnabled as jest.Mock).mockReturnValue(false);
    });

    it('calls fn directly and returns its result', async () => {
      const fn = jest.fn().mockResolvedValue('direct-result');
      const result = await service.withSpan(
        'test.span',
        { kind: SpanKind.INTERNAL },
        fn,
      );

      expect(result).toBe('direct-result');
      expect(fn).toHaveBeenCalled();
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });

    it('does not create a span when tracing is disabled', async () => {
      await service.withSpan('test.span', {}, jest.fn());
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });

    it('propagates rejection without creating a span', async () => {
      const error = new Error('fn error');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(service.withSpan('test.span', {}, fn)).rejects.toThrow(
        'fn error',
      );

      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });

  describe('withSpan - enabled path', () => {
    beforeEach(() => {
      (isTracingEnabled as jest.Mock).mockReturnValue(true);
      (trace.getActiveSpan as jest.Mock).mockReturnValue(undefined);
    });

    it('creates a span and returns fn result on success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await service.withSpan(
        'test.span',
        { kind: SpanKind.INTERNAL, attributes: { key: 'value' } },
        fn,
      );

      expect(result).toBe('success');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.span',
        {
          kind: SpanKind.INTERNAL,
          attributes: { key: 'value' },
        },
        expect.any(Function),
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('defaults to SpanKind.INTERNAL when kind is omitted', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      await service.withSpan('test.span', {}, fn);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.span',
        {
          kind: SpanKind.INTERNAL,
          attributes: undefined,
        },
        expect.any(Function),
      );
    });

    it('records exception and rethrows when fn throws an Error', async () => {
      const error = new Error('test error');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(service.withSpan('test.span', {}, fn)).rejects.toThrow(
        'test error',
      );

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'test error',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('records exception with string error message', async () => {
      const fn = jest.fn().mockRejectedValue('string error');

      await expect(service.withSpan('test.span', {}, fn)).rejects.toBe(
        'string error',
      );

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'string error',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('withDbSpan', () => {
    beforeEach(() => {
      (isTracingEnabled as jest.Mock).mockReturnValue(true);
    });

    it('creates span with db prefix and standard semantic attributes', async () => {
      const fn = jest.fn().mockResolvedValue('db-result');
      await service.withDbSpan('escrow', 'findMany', fn);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'db.escrow.findMany',
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'db.system': 'postgresql',
            'db.operation': 'findMany',
            'db.sql.table': 'escrow',
          },
        },
        expect.any(Function),
      );
    });

    it('returns fn result unchanged', async () => {
      const fn = jest.fn().mockResolvedValue({ id: '1' });
      const result = await service.withDbSpan('escrow', 'findUnique', fn);

      expect(result).toEqual({ id: '1' });
    });
  });

  describe('withWorkflowSpan', () => {
    beforeEach(() => {
      (isTracingEnabled as jest.Mock).mockReturnValue(true);
    });

    it('creates span with workflow prefix and trustlink.workflow attribute', async () => {
      const fn = jest.fn().mockResolvedValue('workflow-result');
      await service.withWorkflowSpan('escrow.create', fn);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'workflow.escrow.create',
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            'trustlink.workflow': 'escrow.create',
          },
        },
        expect.any(Function),
      );
    });

    it('merges additional attributes into the span', async () => {
      const fn = jest.fn().mockResolvedValue('workflow-result');
      await service.withWorkflowSpan('escrow.create', fn, {
        customAttr: 'custom-value',
      });

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'workflow.escrow.create',
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            'trustlink.workflow': 'escrow.create',
            customAttr: 'custom-value',
          },
        },
        expect.any(Function),
      );
    });
  });

  describe('setSpanAttributes', () => {
    it('sets attributes on the active span', () => {
      const activeSpan = { setAttributes: jest.fn() } as unknown as Span;
      (trace.getActiveSpan as jest.Mock).mockReturnValue(activeSpan);

      service.setSpanAttributes({ key: 'value', num: 42 });

      expect(activeSpan.setAttributes).toHaveBeenCalledWith({
        key: 'value',
        num: 42,
      });
    });

    it('does nothing when no active span exists', () => {
      (trace.getActiveSpan as jest.Mock).mockReturnValue(undefined);

      expect(() => {
        service.setSpanAttributes({ key: 'value' });
      }).not.toThrow();
    });
  });
});
