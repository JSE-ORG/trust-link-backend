/// <reference types="jest" />

import { Request, Response, NextFunction } from 'express';
import { LoggerMiddleware } from './logger.middleware';

interface MockRequestOptions {
  method?: string;
  originalUrl?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

interface MockResponseOptions {
  statusCode?: number;
  contentLength?: string | number;
}

describe('LoggerMiddleware', () => {
  let middleware: LoggerMiddleware;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    middleware = new LoggerMiddleware();
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createMockReqRes = (
    reqOptions: MockRequestOptions = {},
    resOptions: MockResponseOptions = {},
  ) => {
    const finishCallbacks: Array<() => void> = [];

    const req = {
      method: reqOptions.method ?? 'GET',
      originalUrl: reqOptions.originalUrl ?? '/test-endpoint',
      ip: reqOptions.ip ?? '127.0.0.1',
      requestId: reqOptions.requestId,
      get: jest.fn().mockImplementation((header: string) => {
        if (header.toLowerCase() === 'user-agent') {
          return reqOptions.userAgent;
        }
        return undefined;
      }),
    } as unknown as Request & { requestId?: string };

    const res = {
      statusCode: resOptions.statusCode ?? 200,
      get: jest.fn().mockImplementation((header: string) => {
        if (header.toLowerCase() === 'content-length') {
          return resOptions.contentLength;
        }
        return undefined;
      }),
      on: jest.fn().mockImplementation((event: string, cb: () => void) => {
        if (event === 'finish') {
          finishCallbacks.push(cb);
        }
      }),
    } as unknown as Response;

    const next: NextFunction = jest.fn();

    const triggerFinish = () => {
      finishCallbacks.forEach((cb) => cb());
    };

    return { req, res, next, triggerFinish };
  };

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should call next() synchronously when invoked', () => {
    const { req, res, next } = createMockReqRes();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should log structured info message on 2xx status code finish', () => {
    const { req, res, next, triggerFinish } = createMockReqRes(
      {
        method: 'GET',
        originalUrl: '/api/v1/escrow/123',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        requestId: 'req-abc-123',
      },
      { statusCode: 200, contentLength: '512' },
    );

    middleware.use(req, res, next);
    triggerFinish();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const logOutput = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(logOutput.trim());

    expect(parsed.level).toBe('info');
    expect(parsed.context).toBe('HTTP');
    expect(parsed.method).toBe('GET');
    expect(parsed.url).toBe('/api/v1/escrow/123');
    expect(parsed.statusCode).toBe(200);
    expect(parsed.msg).toBe('GET /api/v1/escrow/123 200');
    expect(parsed.contentLength).toBe(512);
    expect(parsed.ip).toBe('192.168.1.1');
    expect(parsed.userAgent).toBe('Mozilla/5.0');
    expect(parsed.requestId).toBe('req-abc-123');
    expect(typeof parsed.responseTime).toBe('number');
    expect(parsed.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('should log warn level for 4xx status codes', () => {
    const { req, res, next, triggerFinish } = createMockReqRes(
      { method: 'POST', originalUrl: '/vendor/profile' },
      { statusCode: 400 },
    );

    middleware.use(req, res, next);
    triggerFinish();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.level).toBe('warn');
    expect(parsed.statusCode).toBe(400);
  });

  it('should log error level for 5xx status codes', () => {
    const { req, res, next, triggerFinish } = createMockReqRes(
      { method: 'PUT', originalUrl: '/escrow/cancel' },
      { statusCode: 500 },
    );

    middleware.use(req, res, next);
    triggerFinish();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.level).toBe('error');
    expect(parsed.statusCode).toBe(500);
  });

  it('should handle missing User-Agent by defaulting to empty string', () => {
    const { req, res, next, triggerFinish } = createMockReqRes({
      userAgent: undefined,
    });

    middleware.use(req, res, next);
    triggerFinish();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.userAgent).toBe('');
  });

  it('should handle missing Content-Length header by defaulting to 0', () => {
    const { req, res, next, triggerFinish } = createMockReqRes(
      {},
      { contentLength: undefined },
    );

    middleware.use(req, res, next);
    triggerFinish();

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.contentLength).toBe(0);
  });
});
