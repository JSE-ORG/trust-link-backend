import type { ArgumentsHost } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter body parser errors (#1110)', () => {
  const config = {
    isDevelopment: () => false,
    isProduction: () => true,
  } as unknown as ConfigService;
  const filter = new GlobalExceptionFilter(config);

  function dispatch(exception: unknown) {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      url: '/request',
      requestId: 'req-parser-error',
      method: 'POST',
      ip: '127.0.0.1',
      headers: {},
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(exception, host);
    return response;
  }

  afterEach(() => jest.restoreAllMocks());

  it('keeps the payload-too-large status', () => {
    const response = dispatch(
      Object.assign(new Error('request entity too large'), {
        status: 413,
        type: 'entity.too.large',
      }),
    );

    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        error: 'Payload Too Large',
        requestId: 'req-parser-error',
      }),
    );
  });

  it('keeps the bad-request status for malformed JSON', () => {
    const response = dispatch(
      Object.assign(new SyntaxError('Unexpected token'), {
        status: 400,
        type: 'entity.parse.failed',
      }),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, error: 'Bad Request' }),
    );
  });

  it('does not classify unrelated errors as body parser failures', () => {
    const response = dispatch(
      Object.assign(new Error('database error'), {
        status: 500,
        type: 'database.failure',
      }),
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});
