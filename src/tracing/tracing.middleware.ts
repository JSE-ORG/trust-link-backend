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

      // http.route is deliberately not set here. This middleware runs before
      // routing, so req.route is always undefined; setting it from originalUrl
      // would overwrite the route template and leak ids and query strings
      // (#972). The HTTP instrumentation sets the template after routing.
      if (span) {
        span.setAttribute('trustlink.workflow', workflow);
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
  const path = url.includes('?') ? url.slice(0, url.indexOf('?')) : url;
  const verb = method.toLowerCase();

  // Prefixes must match the controllers in src/. The only auth controller is
  // the SEP-10 flow, mounted at /auth, so it keeps the sep10 workflow name.
  if (path.startsWith('/escrow')) return `escrow.${verb}`;
  if (path.startsWith('/vendor')) return `vendor.${verb}`;
  if (path.startsWith('/auth')) return `sep10.${verb}`;
  if (path.startsWith('/webhooks/stellar')) return 'webhook.stellar';
  if (path.startsWith('/admin/queues')) return 'admin.queues';
  if (path.startsWith('/admin/disputes')) return 'admin.disputes';
  if (path.startsWith('/admin/audit-log')) return 'admin.audit_log';
  if (path.startsWith('/admin/stats')) return 'admin.stats';
  if (path.startsWith('/admin/credentials')) return 'admin.api_keys';
  if (path.startsWith('/admin/dlq')) return 'admin.dlq';
  if (path.startsWith('/stress-test')) return `stress_test.${verb}`;
  if (path === '/health') return 'health.check';
  if (path === '/health/live') return 'health.live';
  if (path === '/health/ready') return 'health.ready';
  if (path === '/version') return 'version.check';

  return `http.${verb}`;
}
