import {
  CallHandler,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import { TimeoutInterceptor } from './timeout.interceptor';

function createMockContext(method: string, url: string): ExecutionContext {
  const req = { method, url, originalUrl: url, path: url };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('TimeoutInterceptor (#1170)', () => {
  const timeoutMs = 50;
  let interceptor: TimeoutInterceptor;

  beforeEach(() => {
    interceptor = new TimeoutInterceptor(timeoutMs);
  });

  it('allows a fast handler to complete without timing out', (done) => {
    const context = createMockContext('GET', '/escrows');
    const handler: CallHandler = {
      handle: () => of({ ok: true }).pipe(delay(10)),
    };

    interceptor.intercept(context, handler).subscribe({
      next: (val) => {
        expect(val).toEqual({ ok: true });
      },
      error: (err) => done(err),
      complete: () => done(),
    });
  });

  it('times out a slow handler and throws 503 ServiceUnavailableException', (done) => {
    const context = createMockContext('GET', '/slow-endpoint');
    const handler: CallHandler = {
      handle: () => of({ ok: true }).pipe(delay(100)),
    };

    interceptor.intercept(context, handler).subscribe({
      next: () => {
        done(new Error('Expected request to time out, but it succeeded'));
      },
      error: (err: unknown) => {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const res = (
          err as ServiceUnavailableException
        ).getResponse() as Record<string, unknown>;
        expect(res.statusCode).toBe(503);
        expect(res.message).toBe('Request timed out');
        expect(res.error).toBe('Service Unavailable');
        done();
      },
    });
  });

  it('exempts POST /stress-test from timeout even if it runs longer than timeoutMs', (done) => {
    const context = createMockContext('POST', '/stress-test');
    const handler: CallHandler = {
      handle: () => of({ stressTest: 'finished' }).pipe(delay(100)),
    };

    interceptor.intercept(context, handler).subscribe({
      next: (val) => {
        expect(val).toEqual({ stressTest: 'finished' });
      },
      error: (err) => done(err),
      complete: () => done(),
    });
  });

  it('does not exempt GET /stress-test from timing out', (done) => {
    const context = createMockContext('GET', '/stress-test');
    const handler: CallHandler = {
      handle: () => of({ stressTest: 'status' }).pipe(delay(100)),
    };

    interceptor.intercept(context, handler).subscribe({
      next: () => {
        done(new Error('Expected GET /stress-test to time out'));
      },
      error: (err: unknown) => {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        done();
      },
    });
  });

  it('passes non-timeout errors through unchanged', (done) => {
    const context = createMockContext('GET', '/error');
    const originalError = new Error('Database connection failed');
    const handler: CallHandler = {
      handle: () => throwError(() => originalError),
    };

    interceptor.intercept(context, handler).subscribe({
      next: () => done(new Error('Expected error')),
      error: (err) => {
        expect(err).toBe(originalError);
        done();
      },
    });
  });
});
