import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { Keypair } from '@stellar/stellar-sdk';
import { ConfigService } from './config.service';
import { stellarPublicKey } from './config.schema';

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
  const keyName = helpers.state.path ? helpers.state.path.join('.') : 'key';
  // Quick shape check first for better error messages
  if (!value.startsWith('S')) {
    return helpers.message({
      custom:
        `${keyName} must be a Stellar secret key ` +
        `starting with S, got a value starting with '${value[0]}'`,
    });
  }

  try {
    Keypair.fromSecret(value);
    return value; // valid — checksum passed
  } catch {
    return helpers.message({
      custom:
        `${keyName} is an invalid Stellar secret key ` +
        `— checksum verification failed. ` +
        `Check the key value in your environment configuration.`,
    });
  }
}, 'Stellar secret key checksum validation');

/**
 * Custom Joi validator asserting the Soroban RPC URL agrees with
 * STELLAR_NETWORK. A URL carrying a "testnet" marker under MAINNET (or a
 * "mainnet" marker under TESTNET) is rejected at startup, so a misconfigured
 * service cannot read events from the wrong chain and apply them to real
 * escrows.
 */
const sorobanRpcUrl = Joi.string()
  .uri()
  .custom((value: string, helpers) => {
    const ancestors = helpers.state.ancestors as
      Array<Record<string, unknown>> | undefined;
    const network = (ancestors?.[0]?.STELLAR_NETWORK as string) ?? 'TESTNET';

    if (network === 'MAINNET' && /testnet/i.test(value)) {
      return helpers.message({
        custom:
          'Config validation error: SOROBAN_RPC_URL points at a testnet ' +
          'endpoint while STELLAR_NETWORK is MAINNET',
      });
    }
    if (network === 'TESTNET' && /mainnet/i.test(value)) {
      return helpers.message({
        custom:
          'Config validation error: SOROBAN_RPC_URL points at a mainnet ' +
          'endpoint while STELLAR_NETWORK is TESTNET',
      });
    }
    return value;
  }, 'Soroban RPC URL / STELLAR_NETWORK agreement');

/** Exported so tests can validate environment shapes without booting Nest. */
export const configValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  CONTACT_ENCRYPTION_KEY: Joi.string()
    .hex()
    .length(64)
    .messages({
      'string.hex':
        'Config validation error: CONTACT_ENCRYPTION_KEY must be a 64-character hexadecimal string',
      'string.length':
        'Config validation error: CONTACT_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)',
    })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required().messages({
        'any.required':
          'Config validation error: CONTACT_ENCRYPTION_KEY is required in production',
      }),
      otherwise: Joi.optional(),
    }),
  CREDENTIAL_ENCRYPTION_KEY: Joi.string()
    .hex()
    .length(64)
    .messages({
      'string.hex':
        'Config validation error: CREDENTIAL_ENCRYPTION_KEY must be a 64-character hexadecimal string',
      'string.length':
        'Config validation error: CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)',
    })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required().messages({
        'any.required':
          'Config validation error: CREDENTIAL_ENCRYPTION_KEY is required in production',
      }),
      otherwise: Joi.optional(),
    }),
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
  STELLAR_NETWORK: Joi.string().valid('TESTNET', 'MAINNET').default('TESTNET'),
  ALLOWED_ORIGINS: Joi.string().optional(),
  CSP_CONNECT_SRC: Joi.string().optional(),
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
    otherwise: Joi.string().uri().allow('').optional(),
  }),
  GIT_SHA: Joi.string().optional(),
  AUTH_CHALLENGE_LIMIT: Joi.number().integer().min(1).default(10),
  AUTH_CHALLENGE_WINDOW: Joi.number().integer().min(1000).default(60000),
  PUBLIC_LIMIT: Joi.number().integer().min(1).default(60),
  PUBLIC_WINDOW: Joi.number().integer().min(1000).default(60000),
  EVIDENCE_UPLOAD_LIMIT: Joi.number().integer().min(1).default(10),
  EVIDENCE_UPLOAD_TTL: Joi.number().integer().min(1000).default(60000),
  REFRESH_TOKEN_TTL: Joi.number().integer().min(60).default(604800),
  LOGISTICS_API_BASE_URL: Joi.string().uri().optional(),
  LOGISTICS_API_KEY: Joi.string().optional(),
  STELLAR_HORIZON_URL: Joi.string().uri().optional(),
  QUERY_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  SLOW_QUERY_THRESHOLD_MS: Joi.number().integer().min(0).default(500),
  // Soroban RPC endpoint for the on-chain event poller. Required in
  // production and whenever STELLAR_NETWORK is MAINNET — there is no safe
  // default mainnet endpoint. Outside production the poller falls back to
  // the public testnet RPC and logs that it did.
  SOROBAN_RPC_URL: sorobanRpcUrl
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required().messages({
        'any.required':
          'Config validation error: SOROBAN_RPC_URL is required in ' +
          'production — refusing to fall back to a default RPC endpoint',
      }),
    })
    .when('STELLAR_NETWORK', {
      is: 'MAINNET',
      then: Joi.required().messages({
        'any.required':
          'Config validation error: SOROBAN_RPC_URL is required when ' +
          'STELLAR_NETWORK is MAINNET (no default mainnet endpoint exists)',
      }),
    }),
  // Poll cadence for the Soroban event poller. Validated here so a
  // non-numeric or too-small value fails at startup instead of producing
  // setInterval(fn, NaN), which fires as fast as the event loop allows and
  // floods the RPC endpoint. The default lives here, nowhere else.
  SOROBAN_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(1000)
    .default(5000)
    .messages({
      'number.base':
        'Config validation error: SOROBAN_POLL_INTERVAL_MS must be an integer number of milliseconds',
      'number.min':
        'Config validation error: SOROBAN_POLL_INTERVAL_MS must be at least 1000ms — lower values flood the RPC endpoint',
    }),
  // Per-request timeout for Soroban RPC calls. Keep it below
  // SOROBAN_POLL_INTERVAL_MS so a hung request cannot span poll cycles.
  SOROBAN_RPC_TIMEOUT_MS: Joi.number().integer().min(100).default(4000),
  // Optional replay point: with no stored cursor the poller starts a small
  // margin behind the current ledger. Set this to replay from a known ledger
  // after an outage instead.
  SOROBAN_START_LEDGER: Joi.number().integer().min(1).optional(),
});

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      validationSchema: configValidationSchema,
      ignoreEnvFile: true,
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
