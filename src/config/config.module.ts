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
      }),
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
