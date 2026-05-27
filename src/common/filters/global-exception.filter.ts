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

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  error?: string;
  details?: unknown;
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

  private buildErrorResponse(exception: unknown, request: Request): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      return {
        statusCode: status,
        timestamp,
        path,
        message: typeof exceptionResponse === 'string' 
          ? exceptionResponse 
          : (exceptionResponse as any)?.message || exception.message,
        error: exception.name,
        ...(this.configService.isDevelopment() && {
          details: typeof exceptionResponse === 'object' ? exceptionResponse : undefined,
        }),
      };
    }

    // Handle Prisma errors
    if (this.isPrismaError(exception)) {
      return this.handlePrismaError(exception, timestamp, path);
    }

    // Handle validation errors
    if (this.isValidationError(exception)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp,
        path,
        message: 'Validation failed',
        error: 'ValidationError',
        ...(this.configService.isDevelopment() && {
          details: (exception as any).details,
        }),
      };
    }

    // Generic error handling
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp,
      path,
      message: this.configService.isProduction() 
        ? 'Internal server error' 
        : (exception as Error)?.message || 'Unknown error',
      error: 'InternalServerError',
      ...(this.configService.isDevelopment() && {
        details: exception instanceof Error ? exception.stack : exception,
      }),
    };
  }

  private handlePrismaError(exception: any, timestamp: string, path: string): ErrorResponse {
    const code = exception.code;
    
    switch (code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          timestamp,
          path,
          message: 'A record with this data already exists',
          error: 'ConflictError',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          timestamp,
          path,
          message: 'Record not found',
          error: 'NotFoundError',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          timestamp,
          path,
          message: 'Database error',
          error: 'DatabaseError',
          ...(this.configService.isDevelopment() && {
            details: { code, message: exception.message },
          }),
        };
    }
  }

  private isPrismaError(exception: unknown): boolean {
    return exception && 
           typeof exception === 'object' && 
           'code' in exception && 
           typeof (exception as any).code === 'string' &&
           (exception as any).code.startsWith('P');
  }

  private isValidationError(exception: unknown): boolean {
    return exception instanceof Error && 
           (exception.name === 'ValidationError' || 
            exception.message.includes('validation'));
  }

  private logError(exception: unknown, request: Request, errorResponse: ErrorResponse): void {
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    
    const logContext = {
      method,
      url,
      ip,
      userAgent,
      statusCode: errorResponse.statusCode,
      timestamp: errorResponse.timestamp,
    };

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `${method} ${url} - ${errorResponse.statusCode} - ${errorResponse.message}`,
        exception instanceof Error ? exception.stack : exception,
        JSON.stringify(logContext),
      );
    } else {
      this.logger.warn(
        `${method} ${url} - ${errorResponse.statusCode} - ${errorResponse.message}`,
        JSON.stringify(logContext),
      );
    }
  }
}