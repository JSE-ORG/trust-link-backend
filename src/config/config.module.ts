import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { Keypair } from '@stellar/stellar-sdk';
import { ConfigService } from './config.service';

/**
 * Custom Joi validator for Stellar secret keys.
 *
 * Validates by DECODING the key via Keypair.fromSecret, not pattern matching
 * alone. This catches checksum errors that the pattern /^S[A-Z2-7]{55}$/ cannot
 * detect.
 *
 * Rejects:
 * - Shape-valid but checksum-invalid keys (e.g. SAAAAAAA...AAAA)
 * - Public keys supplied where a secret key is expected (G... keys)
 * - Completely malformed strings
 */
const stellarSecretKey = Joi.string().custom((value, helpers) => {
  // Quick shape check first for better error messages
  if (!value.startsWith('S')) {
    throw new Error(
      `${helpers.state.path?.[0] || 'SYSTEM_SIGNER_SECRET'} must be a Stellar secret key ` +
      `starting with S, got a value starting with '${value[0]}'`
    );
  }

  try {
    Keypair.fromSecret(value);
    return value; // valid — checksum passed
  } catch {
    throw new Error(
      `${helpers.state.path?.[0] || 'SYSTEM_SIGNER_SECRET'} is an invalid Stellar secret key ` +
      `— checksum verification failed. ` +
      `Check the key value in your environment configuration.`
    );
  }
}, 'Stellar secret key checksum validation');

/**
 * Custom Joi validator for Stellar public keys (G... addresses).
 *
 * Validates by decoding via Keypair.fromPublicKey. Rejects secret keys,
 * malformed strings, and checksum failures.
 */
const stellarPublicKey = Joi.string().custom((value, helpers) => {
  if (!value.startsWith('G')) {
    throw new Error(
      `${helpers.state.path?.[0] || 'ADMIN_ADDRESS'} must be a Stellar public key ` +
      `starting with G, got a value starting with '${value[0]}'`
    );
  }

  try {
    Keypair.fromPublicKey(value);
    return value; // valid
  } catch {
    throw new Error(
      `${helpers.state.path?.[0] || 'ADMIN_ADDRESS'} is an invalid Stellar public key ` +
      `— checksum verification failed.`
    );
  }
}, 'Stellar public key checksum validation');

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        SEP10_JWT_SECRET: Joi.string().min(32).required(),
        // Stellar system signer secret key — validated by Keypair.fromSecret for checksum
        SYSTEM_SIGNER_SECRET: stellarSecretKey.required(),
        // Secret key used to sign SEP-10 challenge transactions. Its public key
        // is what wallets verify against and what a stellar.toml would publish
        // as SIGNING_KEY, so it must be stable across restarts and identical on
        // every replica. Optional: falls back to SYSTEM_SIGNER_SECRET. Set it
        // explicitly to keep web-auth signing separate from transaction signing.
        SEP10_SIGNING_SECRET: stellarSecretKey.optional(),
        // Soroban smart contract ID for the escrow contract
        CONTRACT_ID: Joi.string().required().messages({
          'any.required': 'Config validation error: CONTRACT_ID is required',
        }),
        ADMIN_ADDRESS: stellarPublicKey.required(),
        AUTO_RELEASE_SOURCE_ADDRESS: Joi.string()
          .pattern(/^G[A-Z2-7]{55}$/)
          .optional()
          .messages({
            'string.pattern.base':
              'Config validation error: AUTO_RELEASE_SOURCE_ADDRESS must be a valid Stellar public key (starts with G)',
          }),
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
        STELLAR_WEBHOOK_SECRET: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().required().messages({
            'any.required':
              'Config validation error: STELLAR_WEBHOOK_SECRET is required in production',
          }),
          otherwise: Joi.string().optional(),
        }),
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
