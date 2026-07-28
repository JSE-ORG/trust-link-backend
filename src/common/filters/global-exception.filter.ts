import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '../../config/config.service';
import { StandardErrorResponse } from '../dto/error-response.dto';

interface HttpExceptionResponseBody {
  message?: string | string[];
  details?: unknown;
}

interface PrismaLikeError {
  code: string;
  message?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse = this.buildErrorResponse(exception, request);
    // Log error details
    this.logError(exception, request, errorResponse);

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
  ): StandardErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.url;
    const requestId = request.requestId ?? 'unknown';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const exceptionBody = this.asHttpExceptionBody(exceptionResponse);

      return {
        statusCode: status,
        message:
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exceptionBody.message || exception.message,
        error: exception.name,
        timestamp,
        path,
        requestId,
        ...(this.configService.isDevelopment() && {
          details:
            typeof exceptionResponse === 'object'
              ? exceptionResponse
              : undefined,
        }),
      };
    }

    // Handle Prisma errors
    if (this.isPrismaError(exception)) {
      return this.handlePrismaError(exception, timestamp, path, requestId);
    }

    // Handle validation errors
    if (this.isValidationError(exception)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        error: 'ValidationError',
        timestamp,
        path,
        requestId,
        ...(this.configService.isDevelopment() && {
          details:
            typeof exception === 'object' &&
            exception !== null &&
            'details' in exception
              ? exception.details
              : undefined,
        }),
      };
    }

    // Generic error handling
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.configService.isProduction()
        ? 'Internal server error'
        : (exception as Error)?.message || 'Unknown error',
      error: 'InternalServerError',
      timestamp,
      path,
      requestId,
      ...(this.configService.isDevelopment() && {
        details: exception instanceof Error ? exception.stack : exception,
      }),
    };
  }

  private handlePrismaError(
    exception: PrismaLikeError,
    timestamp: string,
    path: string,
    requestId = 'unknown',
  ): StandardErrorResponse {
    const code = exception.code;

    switch (code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'A record with this data already exists',
          error: 'ConflictError',
          timestamp,
          path,
          requestId,
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'NotFoundError',
          timestamp,
          path,
          requestId,
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          error: 'DatabaseError',
          timestamp,
          path,
          requestId,
          ...(this.configService.isDevelopment() && {
            details: { code, message: exception.message ?? 'Database error' },
          }),
        };
    }
  }

  private isPrismaError(exception: unknown): exception is PrismaLikeError {
    if (
      exception &&
      typeof exception === 'object' &&
      'code' in exception &&
      typeof exception.code === 'string'
    ) {
      return exception.code.startsWith('P');
    }
    return false;
  }

  private isValidationError(exception: unknown): boolean {
    return (
      exception instanceof Error &&
      (exception.name === 'ValidationError' ||
        exception.message.includes('validation'))
    );
  }

  private logError(
    exception: unknown,
    request: Request,
    errorResponse: StandardErrorResponse,
  ): void {
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';

    const logContext = {
      method,
      url,
      ip,
      userAgent,
      requestId: errorResponse.requestId,
      statusCode: errorResponse.statusCode,
      timestamp: errorResponse.timestamp,
    };
    const message = this.formatMessage(errorResponse.message);

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `${method} ${url} - ${errorResponse.statusCode} - ${message}`,
        exception instanceof Error ? exception.stack : exception,
        JSON.stringify(logContext),
      );
    } else {
      this.logger.warn(
        `${method} ${url} - ${errorResponse.statusCode} - ${message}`,
        JSON.stringify(logContext),
      );
    }
  }

  private asHttpExceptionBody(value: unknown): HttpExceptionResponseBody {
    if (value && typeof value === 'object') {
      const body: HttpExceptionResponseBody = value;
      return body;
    }
    return {};
  }

  private formatMessage(message: string | string[]): string {
    return Array.isArray(message) ? message.join('; ') : message;
  }
}
