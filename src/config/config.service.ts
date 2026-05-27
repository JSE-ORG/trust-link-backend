import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SEP10_JWT_SECRET: z.string().min(32, 'SEP10_JWT_SECRET must be at least 32 characters'),
  ADMIN_ADDRESS: z.string().min(1, 'ADMIN_ADDRESS is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SENDGRID_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  STELLAR_NETWORK: z.enum(['TESTNET', 'MAINNET']).default('TESTNET'),
});

export type Config = z.infer<typeof configSchema>;

@Injectable()
export class ConfigService {
  private readonly config: Config;

  constructor() {
    const result = configSchema.safeParse(process.env);
    
    if (!result.success) {
      const errors = result.error.issues.map(
        (err) => `${err.path.join('.')}: ${err.message}`
      ).join('\n');
      throw new Error(`Configuration validation failed:\n${errors}`);
    }
    
    this.config = result.data;
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  get all(): Config {
    return { ...this.config };
  }

  isDevelopment(): boolean {
    return this.config.NODE_ENV === 'development';
  }

  isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  isTest(): boolean {
    return this.config.NODE_ENV === 'test';
  }
}