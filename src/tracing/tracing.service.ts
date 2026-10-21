import { Injectable } from '@nestjs/common';
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from '@opentelemetry/api';
import { isTracingEnabled } from './tracing.bootstrap';

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Issue #79 – Central tracing helpers for database and API workflow spans.
 */
@Injectable()
export class TracingService {
  private readonly tracer = trace.getTracer('trustlink-backend');

  /**
   * True when OpenTelemetry tracing was started for this process.
   *
   * Reflects the one-time bootstrap decision (`tracing.bootstrap`), which
   * reads `OTEL_ENABLED` at startup — it does not re-check config per call
   * and cannot be toggled at runtime. {@link withSpan} guards on this and
   * runs the callback with no span when false, so callers rarely need to
   * check it themselves.
   */
  isEnabled(): boolean {
    return isTracingEnabled();
  }

  /**
   * Returns the span currently bound to the active OTel context, or
   * `undefined` when there is none (no enclosing `withSpan`, or tracing
   * disabled).
   *
   * The result is a live handle to the ambient span, not a copy — callers
   * that want to annotate "the current operation" should prefer
   * {@link setSpanAttributes}, which no-ops safely when this returns
   * `undefined`.
   */
  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * Injects W3C traceparent/tracestate headers for outbound propagation.
   */
  injectTraceHeaders(
    carrier: Record<string, string> = {},
  ): Record<string, string> {
    propagation.inject(context.active(), carrier);
    return carrier;
  }

  /**
   * Records a database operation span with standard semantic attributes.
   */
  withDbSpan<T>(
    model: string,
    operation: string,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    return this.withSpan(
      `db.${model}.${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'db.system': 'postgresql',
          'db.operation': operation,
          'db.sql.table': model,
        },
      },
      fn,
    );
  }

  /**
   * Records a named API workflow span (e.g. escrow.create, sep10.challenge).
   */
  withWorkflowSpan<T>(
    workflow: string,
    fn: () => T | Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    return this.withSpan(
      `workflow.${workflow}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'trustlink.workflow': workflow,
          ...attributes,
        },
      },
      fn,
    );
  }

  /** Runs a function within a named span and records success or failure. */
  async withSpan<T>(
    name: string,
    options: SpanOptions,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    if (!this.isEnabled()) {
      return fn();
    }

    return this.tracer.startActiveSpan(
      name,
      {
        kind: options.kind ?? SpanKind.INTERNAL,
        attributes: options.attributes,
      },
      async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  /**
   * Merges `attributes` onto the currently active span.
   *
   * A safe no-op when there is no active span (tracing disabled, or called
   * outside any `withSpan`/`withDbSpan`/`withWorkflowSpan`), so call sites
   * don't need their own guard. Attributes are set on whatever span is
   * ambient at call time — later keys overwrite earlier ones on the same
   * span; it does not create a span or affect parent/child spans.
   */
  setSpanAttributes(
    attributes: Record<string, string | number | boolean>,
  ): void {
    const span = this.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }
}
