import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import type { Request } from 'express';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number = 30000) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();

      if (req) {
        const method = (req.method || '').toUpperCase();
        const url = req.originalUrl || req.url || req.path || '';
        // POST /stress-test is exempt, since it holds the request for the whole run (#1170)
        if (
          method === 'POST' &&
          (url === '/stress-test' ||
            url.startsWith('/stress-test?') ||
            url.startsWith('/stress-test/'))
        ) {
          return next.handle();
        }
      }
    }

    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new ServiceUnavailableException({
                statusCode: 503,
                message: 'Request timed out',
                error: 'Service Unavailable',
              }),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
