import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

export interface Config {
  PORT: number;
  DATABASE_URL: string;
  DB_POOL_CONNECTION_LIMIT?: number;
  DB_POOL_TIMEOUT_MS?: number;
  SEP10_JWT_SECRET: string;
  ADMIN_ADDRESS: string;
  NODE_ENV: 'development' | 'production' | 'test';
  SENDGRID_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  STELLAR_NETWORK: 'TESTNET' | 'MAINNET';
  ALLOWED_ORIGINS?: string;
  STELLAR_WEBHOOK_SECRET?: string;
  LOG_LEVEL?: string;
  API_BASE_URL?: string;
  REDIS_URL?: string;
  OTEL_ENABLED?: string;
  OTEL_SERVICE_NAME?: string;
  OTEL_SERVICE_VERSION?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  AUTH_CHALLENGE_WINDOW?: number;
  AUTH_CHALLENGE_LIMIT?: number;
  PUBLIC_WINDOW?: number;
  PUBLIC_LIMIT?: number;
  REFRESH_TOKEN_TTL?: number;
  SENTRY_DSN?: string;
  GIT_SHA?: string;
}

@Injectable()
export class ConfigService {
  constructor(
    private readonly nestConfigService: NestConfigService<Config, true>,
  ) {}

  /** Reads a required typed environment value from Nest configuration. */
  get<K extends keyof Config>(key: K): Config[K];
  get<T = unknown>(key: string): T;
  get<T = unknown>(key: string): T {
    return this.nestConfigService.get<T>(key, { infer: true }) as T;
  }

  /** Returns the complete normalized application configuration snapshot. */
  get all(): Config {
    return {
      PORT: this.get('PORT'),
      DATABASE_URL: this.get('DATABASE_URL'),
      SEP10_JWT_SECRET: this.get('SEP10_JWT_SECRET'),
      ADMIN_ADDRESS: this.get('ADMIN_ADDRESS'),
      NODE_ENV: this.get('NODE_ENV'),
      SENDGRID_API_KEY: this.nestConfigService.get('SENDGRID_API_KEY', {
        infer: true,
      }),
      TWILIO_ACCOUNT_SID: this.nestConfigService.get('TWILIO_ACCOUNT_SID', {
        infer: true,
      }),
      TWILIO_AUTH_TOKEN: this.nestConfigService.get('TWILIO_AUTH_TOKEN', {
        infer: true,
      }),
      STELLAR_NETWORK: this.get('STELLAR_NETWORK'),
      ALLOWED_ORIGINS: this.nestConfigService.get('ALLOWED_ORIGINS', {
        infer: true,
      }),
      STELLAR_WEBHOOK_SECRET: this.nestConfigService.get(
        'STELLAR_WEBHOOK_SECRET',
        { infer: true },
      ),
      LOG_LEVEL: this.nestConfigService.get('LOG_LEVEL', { infer: true }),
      API_BASE_URL: this.nestConfigService.get('API_BASE_URL', { infer: true }),
    };
  }

  /**
   * Builds the effective DATABASE_URL by appending Prisma connection-pool
   * parameters when DB_POOL_CONNECTION_LIMIT or DB_POOL_TIMEOUT_MS are set.
   *
   * Prisma reads `connection_limit` and `pool_timeout` from the query string:
   *   postgresql://user:pass@host:5432/db?connection_limit=25&pool_timeout=10
   *
   * Defaults: connection_limit = 10, pool_timeout = 10 (seconds).
   */
  getDatabaseUrl(): string {
    const base = this.get('DATABASE_URL');
    const limit = this.nestConfigService.get('DB_POOL_CONNECTION_LIMIT', {
      infer: true,
    });
    const timeoutMs = this.nestConfigService.get('DB_POOL_TIMEOUT_MS', {
      infer: true,
    });

    if (!limit && !timeoutMs) return base;

    const url = new URL(base);
    if (limit) url.searchParams.set('connection_limit', String(limit));
    if (timeoutMs) {
      // Prisma expects pool_timeout in seconds
      url.searchParams.set('pool_timeout', String(Math.ceil(timeoutMs / 1000)));
    }
    return url.toString();
  }

  /**
   * Returns the list of allowed CORS origins parsed from the ALLOWED_ORIGINS
   * environment variable (comma-separated). Falls back to an empty array so
   * that no origin is allowed when the variable is not set in production.
   */
  getAllowedOrigins(): string[] {
    const raw = this.nestConfigService.get('ALLOWED_ORIGINS', { infer: true });
    if (!raw) return [];
    return raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** Returns true when NODE_ENV is development. */
  isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development';
  }

  /** Returns true when NODE_ENV is production. */
  isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  /** Returns true when NODE_ENV is test. */
  isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
