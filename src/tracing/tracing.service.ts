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

  /** Returns whether tracing is enabled for the current runtime. */
  isEnabled(): boolean {
    return isTracingEnabled();
  }

  /** Returns the active OpenTelemetry span when one is bound to context. */
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

  /** Adds attributes to the active span when tracing context exists. */
  setSpanAttributes(
    attributes: Record<string, string | number | boolean>,
  ): void {
    const span = this.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }
}
