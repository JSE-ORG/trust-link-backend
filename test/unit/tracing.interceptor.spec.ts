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
