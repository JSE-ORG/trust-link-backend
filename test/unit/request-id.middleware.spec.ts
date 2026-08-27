import { RequestIdMiddleware, REQUEST_ID_HEADER } from '../../src/common/middleware/request-id.middleware';
import { Request, Response, NextFunction } from 'express';

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
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'existing-id-123');
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

  it('generates a new UUID if no x-request-id is provided', () => {
    middleware.use(req as Request, res as Response, next);
    expect(req.requestId).toBeDefined();
    expect(req.requestId?.length).toBeGreaterThan(0);
    expect(req.headers[REQUEST_ID_HEADER]).toBe(req.requestId);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalled();
  });
});
