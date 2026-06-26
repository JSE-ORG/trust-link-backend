import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, defer, lastValueFrom } from 'rxjs';
import { TracingService } from './tracing.service';
import { resolveWorkflow } from './tracing.middleware';

/**
 * Creates a child span per NestJS handler so API workflows are visible as
 * distinct segments in distributed traces (issue #79).
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracing: TracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.tracing.isEnabled()) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<{ method: string; originalUrl: string }>();
    const handler = context.getHandler();
    const className = context.getClass().name;
    const workflow = resolveWorkflow(req.method, req.originalUrl);

    return defer(() =>
      this.tracing.withWorkflowSpan(
        workflow,
        () => lastValueFrom(next.handle()),
        {
          'code.function': handler.name,
          'code.namespace': className,
          'http.method': req.method,
          'http.target': req.originalUrl,
        },
      ),
    );
  }
}
