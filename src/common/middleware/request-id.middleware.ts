import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

/** Canonical header used to carry the request/correlation id. */
export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express' {
  interface Request {
    /** Correlation id used to group all log records of a single request. */
    requestId?: string;
  }
}

/**
 * Issue #82 – Request id middleware for tracing across logs.
 *
 * Reuses an inbound `x-request-id` header when the caller already provides one
 * (e.g. an upstream gateway or a retrying client), otherwise generates a UUID
 * fallback. The resolved id is attached to the request, normalised back onto
 * the request headers, and echoed on the response so clients and downstream
 * log records can be correlated with a single API transaction.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const headerValue = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId = headerValue?.trim() || randomUUID();

    req.requestId = requestId;
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
