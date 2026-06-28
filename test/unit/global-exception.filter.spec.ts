/**
 * Unit tests for GlobalExceptionFilter (src/common/filters/global-exception.filter.ts — issue #286).
 */
import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { ConfigService } from '../../src/config/config.service';

// ── helpers ────────────────────────────────────────────────────────────────

interface MockResponse {
  statusCode: number | null;
  body: unknown;
  status: jest.Mock;
  json: jest.Mock;
}

function buildResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: null,
    body: null,
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockImplementation((b) => {
    res.body = b;
  });
  return res;
}

function buildHost(
  res: MockResponse,
  url = '/test',
  requestId?: string,
): ArgumentsHost {
  const req = {
    url,
    requestId,
    method: 'GET',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest-test' },
  } as any;
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
}

function buildConfigService(
  env: 'development' | 'production' | 'test' = 'test',
): jest.Mocked<ConfigService> {
  return {
    isDevelopment: jest.fn().mockReturnValue(env === 'development'),
    isProduction: jest.fn().mockReturnValue(env === 'production'),
    isTest: jest.fn().mockReturnValue(env === 'test'),
    get: jest.fn().mockReturnValue(env),
  } as unknown as jest.Mocked<ConfigService>;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('GlobalExceptionFilter (issue #286)', () => {
  let filter: GlobalExceptionFilter;
  let configService: jest.Mocked<ConfigService>;
  let res: MockResponse;
  let host: ArgumentsHost;

  beforeEach(() => {
    configService = buildConfigService('test');
    filter = new GlobalExceptionFilter(configService);
    res = buildResponse();
    host = buildHost(res, '/api/test');
  });

  describe('Prisma error handling', () => {
    it('maps Prisma P2002 (unique constraint) to 409 Conflict', () => {
      const prismaError = Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
      });
      filter.catch(prismaError, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      const body = res.body as any;
      expect(body.statusCode).toBe(HttpStatus.CONFLICT);
      expect(body.message).toBe('A record with this data already exists');
      expect(body.error).toBe('ConflictError');
    });

    it('maps Prisma P2025 (record not found) to 404 Not Found', () => {
      const prismaError = Object.assign(new Error('Not found'), {
        code: 'P2025',
      });
      filter.catch(prismaError, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const body = res.body as any;
      expect(body.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(body.message).toBe('Record not found');
      expect(body.error).toBe('NotFoundError');
    });

    it('maps an unknown Prisma error code to 500 Internal Server Error', () => {
      const prismaError = Object.assign(new Error('DB problem'), {
        code: 'P9999',
      });
      filter.catch(prismaError, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = res.body as any;
      expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe('DatabaseError');
    });
  });

  describe('HttpException passthrough', () => {
    it('returns the original status code for HttpException', () => {
      const exception = new HttpException('Not here', HttpStatus.NOT_FOUND);
      filter.catch(exception, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const body = res.body as any;
      expect(body.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('sets the error field to the exception class name', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      filter.catch(exception, host);
      const body = res.body as any;
      expect(body.error).toBe('HttpException');
    });

    it('includes path and timestamp in the response', () => {
      filter.catch(new HttpException('gone', HttpStatus.GONE), host);
      const body = res.body as any;
      expect(body.path).toBe('/api/test');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('BadRequestException formatting', () => {
    it('returns 400 for BadRequestException', () => {
      filter.catch(new BadRequestException('Invalid input'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const body = res.body as any;
      expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('includes the exception message in the response body', () => {
      filter.catch(new BadRequestException('Field X is required'), host);
      const body = res.body as any;
      expect(body.message).toContain('Field X is required');
    });

    it('sets error to BadRequestException', () => {
      filter.catch(new BadRequestException('bad'), host);
      const body = res.body as any;
      expect(body.error).toBe('BadRequestException');
    });
  });

  describe('unknown error → 500', () => {
    it('returns 500 for a plain Error object', () => {
      filter.catch(new Error('Something went wrong'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = res.body as any;
      expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe('InternalServerError');
    });

    it('returns 500 for a non-Error thrown value', () => {
      filter.catch('string error', host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('returns 500 for null', () => {
      filter.catch(null, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('hides internal details in production', () => {
      const prodFilter = new GlobalExceptionFilter(
        buildConfigService('production'),
      );
      const prodRes = buildResponse();
      const prodHost = buildHost(prodRes);
      prodFilter.catch(new Error('secret detail'), prodHost);
      const body = prodRes.body as any;
      expect(body.message).toBe('Internal server error');
    });
  });

  describe('response shape', () => {
    it('always includes statusCode, timestamp, and path', () => {
      filter.catch(new Error('any'), host);
      const body = res.body as any;
      expect(body).toHaveProperty('statusCode');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');
    });

    it('attaches the requestId from the request when present', () => {
      const hostWithId = buildHost(res, '/api/x', 'req-abc-123');
      filter.catch(new Error('oops'), hostWithId);
      const body = res.body as any;
      expect(body.requestId).toBe('req-abc-123');
    });
  });
});
