import { Injectable, NestMiddleware } from '@nestjs/common';
import { context, propagation, trace } from '@opentelemetry/api';
import { Request, Response, NextFunction } from 'express';
import { isTracingEnabled } from './tracing.bootstrap';

/**
 * Enriches the active HTTP span with Trust-Link workflow metadata and
 * extracts incoming W3C trace context for distributed tracing (issue #79).
 */
@Injectable()
export class TracingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!isTracingEnabled()) {
      next();
      return;
    }

    const parentContext = propagation.extract(context.active(), req.headers);

    context.with(parentContext, () => {
      const span = trace.getActiveSpan();
      const workflow = resolveWorkflow(req.method, req.originalUrl);

      if (span) {
        span.setAttribute('trustlink.workflow', workflow);
        span.setAttribute('http.route', req.route?.path ?? req.originalUrl);
        if (req.headers['x-request-id']) {
          span.setAttribute(
            'trustlink.request_id',
            String(req.headers['x-request-id']),
          );
        }
      }

      res.on('finish', () => {
        if (span) {
          span.setAttribute('http.response.status_code', res.statusCode);
        }
      });

      next();
    });
  }
}

/** Maps request paths to stable workflow identifiers for trace grouping. */
export function resolveWorkflow(method: string, url: string): string {
  const path = url.split('?')[0] ?? url;

  if (path.startsWith('/escrow')) return `escrow.${method.toLowerCase()}`;
  if (path.startsWith('/vendor')) return `vendor.${method.toLowerCase()}`;
  if (path.startsWith('/auth/sep10')) return `sep10.${method.toLowerCase()}`;
  if (path.startsWith('/webhooks/stellar')) return 'webhook.stellar';
  if (path.startsWith('/admin/queues')) return 'admin.queues';
  if (path.startsWith('/admin/disputes')) return 'admin.disputes';
  if (path.startsWith('/admin/stats')) return 'admin.stats';
  if (path.startsWith('/admin/api-keys')) return 'admin.api_keys';
  if (path === '/health') return 'health.check';
  if (path === '/version') return 'version.check';

  return `http.${method.toLowerCase()}`;
}
