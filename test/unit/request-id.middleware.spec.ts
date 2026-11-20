import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from '../../src/common/middleware/request-id.middleware';
import { Request, Response, NextFunction } from 'express';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    req = { headers: {} };
    res = { setHeader: jest.fn() };
    next = jest.fn();
  });

  it('reuses the existing x-request-id if provided in headers', () => {
    req.headers = { [REQUEST_ID_HEADER]: 'existing-id-123' };
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).toBe('existing-id-123');
    expect(req.headers[REQUEST_ID_HEADER]).toBe('existing-id-123');
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'existing-id-123',
    );
    expect(next).toHaveBeenCalled();
  });

  it('uses the first element if the header is an array', () => {
    req.headers = { [REQUEST_ID_HEADER]: ['id-array-1', 'id-array-2'] };
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).toBe('id-array-1');
    expect(req.headers[REQUEST_ID_HEADER]).toBe('id-array-1');
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'id-array-1');
    expect(next).toHaveBeenCalled();
  });

  it('reuses a 128 character id made only of allowed characters', () => {
    const value = 'a'.repeat(128);
    req.headers = { [REQUEST_ID_HEADER]: value };
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).toBe(value);
  });

  it('replaces an id longer than 128 characters with a generated UUID', () => {
    const value = 'a'.repeat(4000);
    req.headers = { [REQUEST_ID_HEADER]: value };
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).not.toBe(value);
    expect(req.requestId).toMatch(UUID_PATTERN);
    expect(req.headers[REQUEST_ID_HEADER]).toBe(req.requestId);
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      req.requestId,
    );
  });

  it('replaces an id containing characters outside the allowed set with a generated UUID', () => {
    const value = 'id-with-\n-embedded-newline';
    req.headers = { [REQUEST_ID_HEADER]: value };
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).not.toBe(value);
    expect(req.requestId).toMatch(UUID_PATTERN);
    expect(req.headers[REQUEST_ID_HEADER]).toBe(req.requestId);
  });

  it('generates a new UUID if no x-request-id is provided', () => {
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).toBeDefined();
    expect(req.requestId?.length).toBeGreaterThan(0);
    expect(req.headers?.[REQUEST_ID_HEADER]).toBe(req.requestId);
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      req.requestId,
    );
    expect(next).toHaveBeenCalled();
  });
});
