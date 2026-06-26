import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Issue #81 – HTTP request/response logging in structured JSON format.
 *
 * Each finished request emits a single JSON line:
 * {
 *   "level":        "info" | "warn" | "error",
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
  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') ?? '';
    const startTime = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = Number(res.get('Content-Length') ?? 0);
      const responseTime = Date.now() - startTime;

      const level =
        statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

      const entry: Record<string, unknown> = {
        level,
        time: new Date().toISOString(),
        pid: process.pid,
        env: process.env.NODE_ENV ?? 'development',
        context: 'HTTP',
        requestId: req.requestId,
        msg: `${method} ${originalUrl} ${statusCode}`,
        method,
        url: originalUrl,
        statusCode,
        responseTime,
        contentLength,
        ip,
        userAgent,
      };

      process.stdout.write(JSON.stringify(entry) + '\n');
    });

    next();
  }
}
