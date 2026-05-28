import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

export interface Config {
  PORT: number;
  DATABASE_URL: string;
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
}

@Injectable()
export class ConfigService {
  constructor(
    private readonly nestConfigService: NestConfigService<Config, true>,
  ) {}

  get<K extends keyof Config>(key: K): Config[K] {
    const val = this.nestConfigService.get<Config[K]>(key, { infer: true });
    return val as Config[K];
  }

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

  isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development';
  }

  isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
