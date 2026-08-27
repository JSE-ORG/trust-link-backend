import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from '../../src/common/middleware/request-id.middleware';
import { Request, Response, NextFunction } from 'express';

// Mock crypto module to test generated UUIDs.
jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid-1234'),
}));

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      setHeader: jest.fn(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should generate a new request id if none is provided', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.requestId).toBe('mock-uuid-1234');
    expect(mockRequest.headers![REQUEST_ID_HEADER]).toBe('mock-uuid-1234');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'mock-uuid-1234',
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should reuse the existing request id if provided in headers', () => {
    mockRequest.headers = { [REQUEST_ID_HEADER]: 'existing-id-5678' };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.requestId).toBe('existing-id-5678');
    expect(mockRequest.headers![REQUEST_ID_HEADER]).toBe('existing-id-5678');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'existing-id-5678',
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should use the first value if the header is an array', () => {
    mockRequest.headers = { [REQUEST_ID_HEADER]: ['first-id', 'second-id'] };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.requestId).toBe('first-id');
    expect(mockRequest.headers![REQUEST_ID_HEADER]).toBe('first-id');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'first-id',
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should generate a new request id if the existing header is empty whitespace', () => {
    mockRequest.headers = { [REQUEST_ID_HEADER]: '   ' };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.requestId).toBe('mock-uuid-1234');
    expect(mockRequest.headers![REQUEST_ID_HEADER]).toBe('mock-uuid-1234');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'mock-uuid-1234',
    );
    expect(nextFunction).toHaveBeenCalled();
  });
});
