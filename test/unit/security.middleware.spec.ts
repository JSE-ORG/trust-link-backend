import { SecurityMiddleware } from '../../src/common/middleware/security.middleware';
import { Request, Response, NextFunction } from 'express';

describe('SecurityMiddleware', () => {
  let middleware: SecurityMiddleware;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new SecurityMiddleware();
    req = { headers: {} };
    res = { setHeader: jest.fn() };
    next = jest.fn();
  });

  it('sets Cache-Control and Pragma to no-cache if authorization header is present', () => {
    req.headers = { authorization: 'Bearer token' };
    middleware.use(req as Request, res as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalled();
  });

  it('does not set headers if authorization header is not present', () => {
    middleware.use(req as Request, res as Response, next);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
