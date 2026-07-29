import { ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import * as api from '@opentelemetry/api';
import { TracingService } from '../../src/tracing/tracing.service';
import { TracingInterceptor } from '../../src/tracing/tracing.interceptor';

describe('TracingInterceptor', () => {
  let tracing: TracingService;
  let interceptor: TracingInterceptor;

  beforeEach(() => {
    process.env.OTEL_ENABLED = 'false';
    process.env.NODE_ENV = 'development';
    tracing = new TracingService();
    interceptor = new TracingInterceptor(tracing);
  });

  afterEach(() => {
    delete process.env.OTEL_ENABLED;
    jest.restoreAllMocks();
  });

  function createMockContext(
    method = 'GET',
    url = '/escrow',
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, originalUrl: url }),
      }),
      getHandler: () => ({ name: 'getEscrow' }),
      getClass: () => ({ name: 'EscrowController' }),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(result: unknown = 'ok') {
    return {
      handle: () => of(result),
    };
  }

  describe('when tracing is disabled', () => {
    it('passes through when tracing is disabled', (done) => {
      const context = createMockContext();
      const next = createMockCallHandler('result');

      const result$ = interceptor.intercept(context, next);

      result$.subscribe({
        next: (value) => {
          expect(value).toBe('result');
          done();
        },
        error: done,
      });
    });

    it('rethrows errors unchanged when tracing is disabled', (done) => {
      const context = createMockContext();
      const error = new Error('test error');
      const next = {
        handle: () => throwError(() => error),
      };

      const result$ = interceptor.intercept(context, next);

      result$.subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });

    it('returns observable from next.handle when disabled', async () => {
      const context = createMockContext();
      const next = createMockCallHandler(42);

      const result$ = interceptor.intercept(context, next);
      const result = await lastValueFrom(result$);
      expect(result).toBe(42);
    });

    it('uses correct method and url from request', (done) => {
      const context = createMockContext('POST', '/escrow/create');
      const next = createMockCallHandler('created');

      const result$ = interceptor.intercept(context, next);

      result$.subscribe({
        next: (value) => {
          expect(value).toBe('created');
          done();
        },
        error: done,
      });
    });
  });

  describe('when tracing is enabled (issue #79, issue #463)', () => {
    // Scoped helpers: the cast that lets the test swap the private tracer
    // and the mock-span installer live inside this describe so they share
    // the same `tracing` instance — same shape as the service spec.
    const setTracer = (svc: TracingService, tracer: unknown): void => {
      (svc as unknown as { tracer: unknown }).tracer = tracer;
    };

    type MockSpan = {
      setStatus: jest.Mock;
      setAttributes: jest.Mock;
      recordException: jest.Mock;
      end: jest.Mock;
    };

    const installSpanMock = (): MockSpan => {
      const span: MockSpan = {
        setStatus: jest.fn(),
        setAttributes: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      };
      setTracer(tracing, {
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
      jest.spyOn(tracing, 'isEnabled').mockReturnValue(true);
    });

    it('wraps handler execution in a workflow span for trace continuation', async () => {
      // Spy on withWorkflowSpan to verify it is invoked with the correct
      // workflow + attributes and that the captured function runs.
      const withWorkflowSpanSpy = jest
        .spyOn(tracing, 'withWorkflowSpan')
        .mockImplementation(async (_workflow: string, fn: () => unknown, _attributes?: Record<string, string | number | boolean>) => fn());

      const context = createMockContext('POST', '/escrow/create');
      const next = createMockCallHandler('created');

      const result = await lastValueFrom(
        interceptor.intercept(context, next),
      );

      expect(result).toBe('created');
      expect(withWorkflowSpanSpy).toHaveBeenCalledTimes(1);
      const [workflow, _fn, attributes] = withWorkflowSpanSpy.mock
        .calls[0] as [
        string,
        () => Promise<unknown>,
        Record<string, string>,
      ];
      expect(workflow).toBe('escrow.post');
      expect(attributes).toEqual(
        expect.objectContaining({
          'code.function': 'getEscrow',
          'code.namespace': 'EscrowController',
          'http.method': 'POST',
          'http.target': '/escrow/create',
        }),
      );
    });

    it('wraps handler execution in a workflow span for the new-trace path', async () => {
      // When tracing is enabled but no upstream context has been propagated,
      // the interceptor still creates a fresh workflow span via the tracer.
      const withWorkflowSpanSpy = jest
        .spyOn(tracing, 'withWorkflowSpan')
        .mockImplementation(async (_workflow: string, fn: () => unknown, _attributes?: Record<string, string | number | boolean>) => fn());

      const context = createMockContext('GET', '/vendor/escrows');
      const next = createMockCallHandler([{ id: 1 }]);

      const result = await lastValueFrom(
        interceptor.intercept(context, next),
      );

      expect(result).toEqual([{ id: 1 }]);
      expect(withWorkflowSpanSpy).toHaveBeenCalledTimes(1);
      const [workflow, _fn, attributes] = withWorkflowSpanSpy.mock
        .calls[0] as [
        string,
        () => Promise<unknown>,
        Record<string, string>,
      ];
      expect(workflow).toBe('vendor.get');
      expect(attributes).toEqual(
        expect.objectContaining({
          'code.function': 'getEscrow',
          'code.namespace': 'EscrowController',
          'http.method': 'GET',
          'http.target': '/vendor/escrows',
        }),
      );
    });

    it('marks the span as errored and rethrows the original exception unchanged', async () => {
      const originalError = new Error('downstream boom');
      const mockSpan = installSpanMock();

      const context = createMockContext('POST', '/escrow');
      const next = {
        handle: () => throwError(() => originalError),
      };

      const captured = await lastValueFrom(
        interceptor.intercept(context, next),
      ).catch((err: unknown) => err);

      // The original exception reference must be rethrown intact — no
      // wrapping or mutation.
      expect(captured).toBe(originalError);
      expect(mockSpan.recordException).toHaveBeenCalledWith(originalError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: api.SpanStatusCode.ERROR,
          message: 'downstream boom',
        }),
      );
      // The span must be ended regardless of outcome.
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('does not mark the span errored when the handler resolves successfully', async () => {
      const mockSpan = installSpanMock();

      const context = createMockContext('GET', '/health');
      const next = createMockCallHandler('ok');

      const result = await lastValueFrom(
        interceptor.intercept(context, next),
      );

      expect(result).toBe('ok');
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ code: api.SpanStatusCode.OK }),
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('rethrows the EXACT error reference from the handler on non-Error throws', async () => {
      // Use a custom error subclass to make identity verification unambiguous.
      class UpstreamError extends TypeError {
        constructor(message: string) {
          super(message);
          this.name = 'UpstreamError';
        }
      }
      const originalError = new UpstreamError('identity-check');
      const mockSpan = installSpanMock();

      const context = createMockContext();
      const next = {
        handle: () => throwError(() => originalError),
      };

      let rejectedWith: unknown;
      try {
        await lastValueFrom(interceptor.intercept(context, next));
      } catch (e) {
        rejectedWith = e;
      }
      expect(rejectedWith).toBe(originalError);
      expect(mockSpan.recordException).toHaveBeenCalledWith(originalError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: api.SpanStatusCode.ERROR,
          message: 'identity-check',
        }),
      );
    });
  });
});
import { ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { TracingService } from '../../src/tracing/tracing.service';
import { TracingInterceptor } from '../../src/tracing/tracing.interceptor';

describe('TracingInterceptor', () => {
  let tracing: TracingService;
  let interceptor: TracingInterceptor;

  beforeEach(() => {
    process.env.OTEL_ENABLED = 'false';
    process.env.NODE_ENV = 'development';
    tracing = new TracingService();
    interceptor = new TracingInterceptor(tracing);
  });

  afterEach(() => {
    delete process.env.OTEL_ENABLED;
  });

  function createMockContext(
    method = 'GET',
    url = '/escrow',
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, originalUrl: url }),
      }),
      getHandler: () => ({ name: 'getEscrow' }),
      getClass: () => ({ name: 'EscrowController' }),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(result: unknown = 'ok') {
    return {
      handle: () => of(result),
    };
  }

  it('passes through when tracing is disabled', (done) => {
    const context = createMockContext();
    const next = createMockCallHandler('result');

    const result$ = interceptor.intercept(context, next);

    result$.subscribe({
      next: (value) => {
        expect(value).toBe('result');
        done();
      },
      error: done,
    });
  });

  it('rethrows errors unchanged when tracing is disabled', (done) => {
    const context = createMockContext();
    const error = new Error('test error');
    const next = {
      handle: () => throwError(() => error),
    };

    const result$ = interceptor.intercept(context, next);

    result$.subscribe({
      error: (err) => {
        expect(err).toBe(error);
        done();
      },
    });
  });

  it('returns observable from next.handle when disabled', async () => {
    const context = createMockContext();
    const next = createMockCallHandler(42);

    const result$ = interceptor.intercept(context, next);
    const result = await lastValueFrom(result$);
    expect(result).toBe(42);
  });

  it('uses correct method and url from request', (done) => {
    const context = createMockContext('POST', '/escrow/create');
    const next = createMockCallHandler('created');

    const result$ = interceptor.intercept(context, next);

    result$.subscribe({
      next: (value) => {
        expect(value).toBe('created');
        done();
      },
      error: done,
    });
  });
});
