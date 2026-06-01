import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { ConfigService } from './config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        SEP10_JWT_SECRET: Joi.string().min(32).required(),
        ADMIN_ADDRESS: Joi.string().required(),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        SENDGRID_API_KEY: Joi.string().optional(),
        TWILIO_ACCOUNT_SID: Joi.string().optional(),
        TWILIO_AUTH_TOKEN: Joi.string().optional(),
        STELLAR_NETWORK: Joi.string()
          .valid('TESTNET', 'MAINNET')
          .default('TESTNET'),
        // Comma-separated list of allowed frontend origins, e.g.
        // "https://app.trust-link.io,https://staging.trust-link.io"
        ALLOWED_ORIGINS: Joi.string().optional(),
        // HMAC secret used to verify Stellar Horizon webhook payloads
        STELLAR_WEBHOOK_SECRET: Joi.string().optional(),
        // Minimum log level: trace | debug | info | warn | error | fatal
        LOG_LEVEL: Joi.string()
          .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
          .default('info'),
        // Issue #103 – Redis connection URL for response caching.
        // Omitting this disables caching gracefully (no-op fallback).
        REDIS_URL: Joi.string().uri().optional(),
        // Issue #105 – Database connection pool tuning
        DB_POOL_CONNECTION_LIMIT: Joi.number().integer().min(1).default(10),
        DB_POOL_TIMEOUT_MS: Joi.number().integer().min(0).default(10000),
        // Issue #79 – OpenTelemetry distributed tracing
        OTEL_ENABLED: Joi.string().valid('true', 'false').default('true'),
        OTEL_SERVICE_NAME: Joi.string().default('trustlink-backend'),
        OTEL_SERVICE_VERSION: Joi.string().default('1.0.0'),
        OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional(),
        // Issue #28 – Sentry error monitoring
        SENTRY_DSN: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().uri().required(),
          otherwise: Joi.string().uri().optional(),
        }),
        GIT_SHA: Joi.string().optional(),
      }),
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
