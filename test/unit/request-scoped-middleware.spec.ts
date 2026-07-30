import { Request, Response, NextFunction } from 'express';
import { SecurityMiddleware } from '../../src/common/middleware/security.middleware';
import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from '../../src/common/middleware/request-id.middleware';
import { LoggerMiddleware } from '../../src/common/middleware/logger.middleware';

function createMockResponse(): Response {
  const headers: Record<string, string> = {};
  return {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    getHeader: (name: string) => headers[name],
    get: jest.fn((name: string) => headers[name]),
    on: jest.fn(),
    statusCode: 200,
  } as unknown as Response;
}

describe('SecurityMiddleware', () => {
  let middleware: SecurityMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new SecurityMiddleware();
    next = jest.fn();
  });

  it('sets Cache-Control and Pragma when an Authorization header is present', () => {
    const req = { headers: { authorization: 'Bearer token' } } as Request;
    const res = createMockResponse();

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not set cache headers on an unauthenticated request, so public routes stay cacheable', () => {
    const req = { headers: {} } as Request;
    const res = createMockResponse();

    middleware.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    next = jest.fn();
  });

  it('generates a request id when none is supplied', () => {
    const req = { headers: {} } as unknown as Request;
    const res = createMockResponse();

    middleware.use(req, res, next);

    expect(req.requestId).toEqual(expect.any(String));
    expect(req.requestId!.length).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      req.requestId,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('honours an inbound x-request-id header', () => {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'client-supplied-id' },
    } as unknown as Request;
    const res = createMockResponse();

    middleware.use(req, res, next);

    expect(req.requestId).toBe('client-supplied-id');
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'client-supplied-id',
    );
  });

  // Finding for #571: the middleware accepts *any* client-supplied
  // x-request-id verbatim (only whitespace-trimmed, no format/length
  // validation) and echoes it straight into every log line for the
  // request. An attacker-controlled id containing e.g. newlines or log
  // markup would flow unvalidated into logs — worth raising as its own
  // issue rather than fixing here (out of scope for this ticket).
  it('accepts an inbound id verbatim with no format validation (documented finding, not fixed here)', () => {
    const suspicious = 'id-with-\n-embedded-newline';
    const req = {
      headers: { [REQUEST_ID_HEADER]: suspicious },
    } as unknown as Request;
    const res = createMockResponse();

    middleware.use(req, res, next);

    expect(req.requestId).toBe(suspicious);
  });

  it('picks the first value when the header arrives as an array', () => {
    const req = {
      headers: { [REQUEST_ID_HEADER]: ['first-id', 'second-id'] },
    } as unknown as Request;
    const res = createMockResponse();

    middleware.use(req, res, next);

    expect(req.requestId).toBe('first-id');
  });
});

describe('LoggerMiddleware', () => {
  it('does not throw and calls next()', () => {
    const middleware = new LoggerMiddleware();
    const next = jest.fn();
    const req = {
      method: 'GET',
      originalUrl: '/health',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('jest-test-agent'),
    } as unknown as Request;
    const res = createMockResponse();

    expect(() => middleware.use(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('writes a structured JSON log line when the response finishes', () => {
    const middleware = new LoggerMiddleware();
    const next = jest.fn();
    let finishCallback: (() => void) | undefined;
    const req = {
      method: 'POST',
      originalUrl: '/escrow',
      ip: '127.0.0.1',
      requestId: 'req-123',
      get: jest.fn().mockReturnValue('jest-test-agent'),
    } as unknown as Request;
    const res = {
      ...createMockResponse(),
      statusCode: 201,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
      }),
    } as unknown as Response;

    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    middleware.use(req, res, next);
    finishCallback?.();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(line).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: '/escrow',
        statusCode: 201,
        requestId: 'req-123',
        context: 'HTTP',
      }),
    );

    writeSpy.mockRestore();
  });
});
