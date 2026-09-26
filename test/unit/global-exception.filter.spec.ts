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
import { StandardErrorResponse } from '../../src/common/dto/error-response.dto';

// ─ helpers ───────────────────────│

interface MockResponse {
  statusCode: number | null;
  body: StandardErrorResponse | null;
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
  res.json.mockImplementation((b: StandardErrorResponse) => {
    res.body = b;
  });
  return res;
}

interface MockRequest {
  url: string;
  requestId?: string;
  method: string;
  ip: string;
  headers: Record<string, string>;
}

function buildHost(
  res: MockResponse,
  url = '/test',
  requestId?: string,
): ArgumentsHost {
  const req: MockRequest = {
    url,
    requestId,
    method: 'GET',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest-test' },
  };
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

// ─ tests ───────────────────────│

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
      const body = res.body as StandardErrorResponse;
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
      const body = res.body as StandardErrorResponse;
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
      const body = res.body as StandardErrorResponse;
      expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe('DatabaseError');
    });
  });

  describe('HttpException passthrough', () => {
    it('returns the original status code for HttpException', () => {
      const exception = new HttpException('Not here', HttpStatus.NOT_FOUND);
      filter.catch(exception, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const body = res.body as StandardErrorResponse;
      expect(body.statusCode).toBe(HttpStatus.NOT_FOUND);
    });

    it('sets the error field to the exception class name', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      filter.catch(exception, host);
      const body = res.body as StandardErrorResponse;
      expect(body.error).toBe('HttpException');
    });

    it('includes path and timestamp in the response', () => {
      filter.catch(new HttpException('gone', HttpStatus.GONE), host);
      const body = res.body as StandardErrorResponse;
      expect(body.path).toBe('/api/test');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('BadRequestException formatting', () => {
    it('returns 400 for BadRequestException', () => {
      filter.catch(new BadRequestException('Invalid input'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const body = res.body as StandardErrorResponse;
      expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('includes the exception message in the response body', () => {
      filter.catch(new BadRequestException('Field X is required'), host);
      const body = res.body as StandardErrorResponse;
      const message = Array.isArray(body.message)
        ? body.message.join(' ')
        : body.message;
      expect(message).toContain('Field X is required');
    });

    it('sets error to BadRequestException', () => {
      filter.catch(new BadRequestException('bad'), host);
      const body = res.body as StandardErrorResponse;
      expect(body.error).toBe('BadRequestException');
    });
  });

  describe('unknown error → 500', () => {
    it('returns 500 for a plain Error object', () => {
      filter.catch(new Error('Something went wrong'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = res.body as StandardErrorResponse;
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
      const body = prodRes.body as StandardErrorResponse;
      expect(body.message).toBe('Internal server error');
      expect(body).not.toHaveProperty('details');
    });
  });

  describe('dev-only details disclosure', () => {
    it('includes details for validation errors in development', () => {
      filter = new GlobalExceptionFilter(buildConfigService('development'));
      filter.catch(new BadRequestException('Validation failed'), host);
      const body = res.body as StandardErrorResponse;
      expect(body.details).toBeDefined();
    });

    it('omits details for validation errors outside development', () => {
      filter = new GlobalExceptionFilter(buildConfigService('production'));
      filter.catch(new BadRequestException('Validation failed'), host);
      const body = res.body as StandardErrorResponse;
      expect(body).not.toHaveProperty('details');
    });

    it('includes details for unknown errors in development', () => {
      filter = new GlobalExceptionFilter(buildConfigService('development'));
      filter.catch(new Error('secret'), host);
      const body = res.body as StandardErrorResponse;
      expect(body.details).toBeDefined();
    });
  });

  describe('error type guards', () => {
    it('isPrismaError matches Prisma errors', () => {
      const prismaError = Object.assign(new Error('unique'), { code: 'P2002' });
      filter.catch(prismaError, host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    });

    it('isPrismaError does not match non-Prisma errors', () => {
      const nonPrismaError = Object.assign(new Error('custom'), {
        code: 'E123',
      });
      filter.catch(nonPrismaError, host);
      const body = res.body as StandardErrorResponse;
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe('InternalServerError');
    });

    it('isValidationError matches BadRequestException', () => {
      filter.catch(new BadRequestException('bad input'), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('isValidationError does not match other HttpExceptions', () => {
      filter.catch(new HttpException('not found', HttpStatus.NOT_FOUND), host);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });
  });

  describe('response shape', () => {
    it('always includes statusCode, timestamp, and path', () => {
      filter.catch(new Error('any'), host);
      const body = res.body as StandardErrorResponse;
      expect(body).toHaveProperty('statusCode');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');
    });

    it('attaches the requestId from the request when present', () => {
      const hostWithId = buildHost(res, '/api/x', 'req-abc-123');
      filter.catch(new Error('oops'), hostWithId);
      const body = res.body as StandardErrorResponse;
      expect(body.requestId).toBe('req-abc-123');
    });
  });
});

// ── Issue #727 — uncovered branches ──────────────────────────────────────────

describe('GlobalExceptionFilter (issue #727) — uncovered branches', () => {
  let res: MockResponse;
  let host: ArgumentsHost;

  beforeEach(() => {
    res = buildResponse();
    host = buildHost(res, '/api/test', 'req-727');
  });

  // ── requestId = 'unknown' default ──────────────────────────────────────────

  describe('requestId fallback', () => {
    it("uses 'unknown' as requestId when the request carries no requestId", () => {
      const filter = new GlobalExceptionFilter(buildConfigService('test'));
      // buildHost with no third argument leaves requestId undefined
      const hostNoId = buildHost(res, '/api/test');
      filter.catch(new Error('oops'), hostNoId);
      const body = res.body as StandardErrorResponse;
      expect(body.requestId).toBe('unknown');
    });
  });

  // ── HttpException: isDevelopment() detail disclosure ──────────────────────

  describe('HttpException — isDevelopment() detail disclosure', () => {
    it('includes details on the HttpException path in development', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('development'));
      // HttpException with an object response so details can be spread
      const exception = new HttpException(
        { message: 'oops', extra: 'dev-only' },
        HttpStatus.BAD_REQUEST,
      );
      filter.catch(exception, host);
      const body = res.body as StandardErrorResponse;
      expect(body.details).toBeDefined();
    });

    it('omits details on the HttpException path in production', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('production'));
      const exception = new HttpException(
        { message: 'oops', extra: 'should-be-hidden' },
        HttpStatus.BAD_REQUEST,
      );
      filter.catch(exception, host);
      const body = res.body as StandardErrorResponse;
      expect(body).not.toHaveProperty('details');
    });
  });

  // ── HttpException: exceptionBody.message || exception.message fallback ────

  describe('HttpException — message fallback', () => {
    it('falls back to exception.message when exceptionBody.message is absent', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('test'));
      // Pass a string response so exceptionBody.message is undefined —
      // the filter reaches `exceptionBody.message || exception.message`
      // and must use exception.message.
      const exception = new HttpException('Fallback message', HttpStatus.BAD_REQUEST);
      filter.catch(exception, host);
      const body = res.body as StandardErrorResponse;
      // When the response is a plain string the filter uses it directly,
      // so the message equals that string.
      expect(body.message).toBe('Fallback message');
    });

    it('uses exceptionBody.message when it is present', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('test'));
      const exception = new HttpException(
        { message: 'Body message', statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      );
      filter.catch(exception, host);
      const body = res.body as StandardErrorResponse;
      const msg = Array.isArray(body.message)
        ? body.message[0]
        : body.message;
      expect(msg).toBe('Body message');
    });
  });

  // ── isValidationError() branch ────────────────────────────────────────────

  describe('isValidationError() branch', () => {
    it('matches an error whose name is ValidationError and returns 400', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('test'));
      const err = new Error('data did not pass validation');
      err.name = 'ValidationError';
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toBe('Validation failed');
    });

    it('matches an error whose message contains "validation" and returns 400', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('test'));
      const err = new Error('schema validation failed for field x');
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(body.error).toBe('ValidationError');
    });

    it('includes details on the ValidationError path in development', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('development'));
      const err = Object.assign(new Error('validation failed'), {
        name: 'ValidationError',
        details: { field: 'email', issue: 'invalid format' },
      });
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect(body.details).toBeDefined();
      expect(body.details).toMatchObject({ field: 'email' });
    });

    it('omits details on the ValidationError path in production', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('production'));
      const err = Object.assign(new Error('validation failed'), {
        name: 'ValidationError',
        details: { field: 'email' },
      });
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect(body).not.toHaveProperty('details');
    });
  });

  // ── Prisma default branch: isDevelopment() + message ?? 'Database error' ──

  describe('Prisma default branch', () => {
    it('exposes code and message in development', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('development'));
      const err = { code: 'P9000', message: 'deadlock detected' };
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe('DatabaseError');
      expect(body.details).toBeDefined();
      expect((body.details as Record<string, unknown>).code).toBe('P9000');
      expect((body.details as Record<string, unknown>).message).toBe('deadlock detected');
    });

    it('omits details in production', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('production'));
      const err = { code: 'P9000', message: 'deadlock detected' };
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect(body).not.toHaveProperty('details');
    });

    it('falls back to "Database error" string when exception.message is absent', () => {
      const filter = new GlobalExceptionFilter(buildConfigService('development'));
      // No message property — exercises the `?? 'Database error'` branch
      const err = { code: 'P9000' };
      filter.catch(err, host);
      const body = res.body as StandardErrorResponse;
      expect((body.details as Record<string, unknown>).message).toBe('Database error');
    });
  });
});
