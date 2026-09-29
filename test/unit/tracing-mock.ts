import { TracingService } from '../../src/tracing/tracing.service';

export interface TracingMock {
  service: TracingService;
  withSpan: jest.Mock;
}

/**
 * A `TracingService` stand-in for unit tests.
 *
 * `withSpan` invokes the wrapped function and records the call, so a service
 * under test still behaves normally while its span usage is observable. Span
 * names and attributes can be asserted directly on `withSpan.mock.calls`.
 */
export function createTracingMock(): TracingMock {
  const withSpan = jest.fn(
    async (_name: string, _options: unknown, fn: () => unknown) => fn(),
  );

  const service = {
    withSpan,
    withDbSpan: jest.fn(
      async (
        _model: string,
        _operation: string,
        attributes: unknown,
        fn: () => unknown,
      ) => {
        void attributes;
        return fn();
      },
    ),
    withWorkflowSpan: withSpan,
    setActiveSpanAttributes: jest.fn(),
  } as unknown as TracingService;

  return { service, withSpan };
}

/** Span names recorded by a {@link createTracingMock} mock, in call order. */
export function spanNames(withSpan: jest.Mock): string[] {
  return withSpan.mock.calls.map((call) => call[0] as string);
}
