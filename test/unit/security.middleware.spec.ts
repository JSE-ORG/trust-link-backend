import { SecurityMiddleware } from '../../src/common/middleware/security.middleware';
import { Request, Response, NextFunction } from 'express';

describe('SecurityMiddleware', () => {
  let middleware: SecurityMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    middleware = new SecurityMiddleware();
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      setHeader: jest.fn(),
    };
    nextFunction = jest.fn();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should set cache control headers if authorization header is present', () => {
    mockRequest.headers = { authorization: 'Bearer token' };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should not set cache control headers if authorization header is not present', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });
});
