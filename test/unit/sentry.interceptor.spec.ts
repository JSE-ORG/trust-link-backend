import { ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import * as Sentry from '@sentry/nestjs';
import { SentryInterceptor } from '../../src/common/interceptors/sentry.interceptor';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

describe('SentryInterceptor', () => {
  let interceptor: SentryInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new SentryInterceptor();
  });

  function createMockContext(body: unknown = { email: 'buyer@example.com' }) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/escrow',
          body,
          headers: { authorization: 'Bearer secret-token' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(result: unknown = 'ok') {
    return { handle: () => of(result) };
  }

  it('passes a successful response through untouched and reports nothing', async () => {
    const context = createMockContext();
    const next = createMockCallHandler('escrow-created');

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toBe('escrow-created');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports a thrown error to Sentry and rethrows the exact reference', async () => {
    const originalError = new Error('downstream failure');
    const context = createMockContext();
    const next = { handle: () => throwError(() => originalError) };

    let rejectedWith: unknown;
    try {
      await lastValueFrom(interceptor.intercept(context, next));
    } catch (e) {
      rejectedWith = e;
    }

    expect(rejectedWith).toBe(originalError);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(originalError);
  });

  it('does not swallow the error into a successful response (would turn a 4xx/5xx into a 200)', (done) => {
    const originalError = new Error('must not be swallowed');
    const context = createMockContext();
    const next = { handle: () => throwError(() => originalError) };

    let nextCalled = false;
    interceptor.intercept(context, next).subscribe({
      next: () => {
        nextCalled = true;
      },
      error: (err) => {
        expect(nextCalled).toBe(false);
        expect(err).toBe(originalError);
        done();
      },
    });
  });

  // Finding for #573: does the interceptor attach request bodies/headers to
  // the Sentry event? The interceptor only calls `Sentry.captureException(err)`
  // with no second `context`/`extra` argument and never reads `ExecutionContext`
  // at all — so no request body, header, or PII ever reaches Sentry through
  // this interceptor. Sentry's own default HTTP integration is a separate,
  // unrelated concern (out of scope here, per the issue).
  it('never reads the ExecutionContext, so no request body or header can be attached to the Sentry event', async () => {
    const context = createMockContext({
      email: 'buyer@example.com',
      phone: '+1234567890',
    });
    const switchToHttpSpy = jest.spyOn(context, 'switchToHttp');
    const next = { handle: () => throwError(() => new Error('boom')) };

    await lastValueFrom(interceptor.intercept(context, next)).catch(
      () => undefined,
    );

    expect(switchToHttpSpy).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    // captureException is called with exactly one argument (the error) —
    // no request/body/headers object is ever passed alongside it.
    expect((Sentry.captureException as jest.Mock).mock.calls[0]).toHaveLength(
      1,
    );
  });
});
