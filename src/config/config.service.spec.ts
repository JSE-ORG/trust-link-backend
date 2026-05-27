import { ConfigService } from './config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should validate required environment variables', () => {
    // Set minimal required env vars
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.SEP10_JWT_SECRET = 'a-very-long-secret-key-for-testing-purposes';
    process.env.ADMIN_ADDRESS = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    expect(() => new ConfigService()).not.toThrow();
  });

  it('should throw error for missing required variables', () => {
    delete process.env.DATABASE_URL;
    delete process.env.SEP10_JWT_SECRET;
    delete process.env.ADMIN_ADDRESS;

    expect(() => new ConfigService()).toThrow('Configuration validation failed');
  });

  it('should use default values for optional variables', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.SEP10_JWT_SECRET = 'a-very-long-secret-key-for-testing-purposes';
    process.env.ADMIN_ADDRESS = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    process.env.NODE_ENV = 'development'; // Explicitly set to development

    const config = new ConfigService();
    
    expect(config.get('PORT')).toBe(3000);
    expect(config.get('NODE_ENV')).toBe('development');
    expect(config.get('STELLAR_NETWORK')).toBe('TESTNET');
  });

  it('should validate JWT secret length', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.SEP10_JWT_SECRET = 'short'; // Too short
    process.env.ADMIN_ADDRESS = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    expect(() => new ConfigService()).toThrow('SEP10_JWT_SECRET must be at least 32 characters');
  });
});