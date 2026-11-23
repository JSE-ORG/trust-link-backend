import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JsonLoggerService } from '../logger/json-logger.service';
import type { AuthUser } from '../../auth/auth-user';

const HEALTH_PROBE_PATH = /^\/health(?:\/live|\/ready)?\/?$/;

/**
 * Issue #81 – HTTP request/response logging in structured JSON format.
 *
 * Each finished request emits a single JSON line:
 * {
 *   "level":        "info" | "warn" | "error" | "debug",
 *   "time":         "<ISO-8601>",
 *   "pid":          <number>,
 *   "env":          "<NODE_ENV>",
 *   "context":      "HTTP",
 *   "msg":          "GET /escrow/123 200",
 *   "method":       "GET",
 *   "url":          "/escrow/123",
 *   "statusCode":   200,
 *   "responseTime": 42,
 *   "contentLength": 512,
 *   "ip":           "::1",
 *   "userAgent":    "..."
 * }
 */
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(
    private readonly logger: JsonLoggerService = new JsonLoggerService(),
  ) {}

  /**
   * Logs structured request metadata and response timing upon response completion.
   *
   * @param req Express request object.
   * @param res Express response object.
   * @param next Next middleware function.
   */
  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') ?? '';
    const startTime = Date.now();

    res.on('finish', () => {
      // JwtGuard executes after the middleware is registered. Read the user
      // here, on finish, so the authenticated claim is present when available.
      const user = (req as Request & { user?: AuthUser }).user;
      const { statusCode } = res;
      const contentLength = Number(res.get('Content-Length') ?? 0);
      const responseTime = Date.now() - startTime;
      const path = originalUrl.split('?')[0];
      const isSuccessfulHealthProbe =
        statusCode < 400 && HEALTH_PROBE_PATH.test(path);

      const level =
        statusCode >= 500
          ? 'error'
          : statusCode >= 400
            ? 'warn'
            : isSuccessfulHealthProbe
              ? 'debug'
              : 'info';

      this.logger.structured(
        level,
        `${method} ${originalUrl} ${statusCode}`,
        {
          requestId: req.requestId,
          method,
          url: originalUrl,
          statusCode,
          responseTime,
          contentLength,
          ip,
          userAgent,
          ...(user
            ? {
                userAddress: user.address,
                ...(user.role === 'admin' ? { role: 'admin' } : {}),
              }
            : {}),
        },
        'HTTP',
      );
    });

    next();
  }
}
