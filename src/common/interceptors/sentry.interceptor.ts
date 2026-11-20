import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

export function isServerError(error: unknown): boolean {
  return !(error instanceof HttpException) || error.getStatus() >= 500;
}

@Injectable()
export class SentryInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (isServerError(err)) {
          Sentry.captureException(err);
        }
        return throwError(() => err);
      }),
    );
  }
}
