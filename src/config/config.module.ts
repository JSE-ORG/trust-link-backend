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
        // Stellar system signer secret key — must start with 'S' (StrKey encoded)
        SYSTEM_SIGNER_SECRET: Joi.string()
          .pattern(/^S[A-Z2-7]{55}$/)
          .required()
          .messages({
            'string.pattern.base':
              'Config validation error: SYSTEM_SIGNER_SECRET must be a valid Stellar secret key (starts with S)',
            'any.required':
              'Config validation error: SYSTEM_SIGNER_SECRET is required',
          }),
        // Soroban smart contract ID for the escrow contract
        CONTRACT_ID: Joi.string().required().messages({
          'any.required': 'Config validation error: CONTRACT_ID is required',
        }),
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
        ALLOWED_ORIGINS: Joi.string().optional(),
        STELLAR_WEBHOOK_SECRET: Joi.string().optional(),
        LOG_LEVEL: Joi.string()
          .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
          .default('info'),
        REDIS_URL: Joi.string().uri().optional(),
        DB_POOL_CONNECTION_LIMIT: Joi.number().integer().min(1).default(10),
        DB_POOL_TIMEOUT_MS: Joi.number().integer().min(0).default(10000),
        OTEL_ENABLED: Joi.string().valid('true', 'false').default('true'),
        OTEL_SERVICE_NAME: Joi.string().default('trustlink-backend'),
        OTEL_SERVICE_VERSION: Joi.string().default('1.0.0'),
        OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional(),
        SENTRY_DSN: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().uri().required(),
          otherwise: Joi.string().uri().optional(),
        }),
        GIT_SHA: Joi.string().optional(),
      }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
