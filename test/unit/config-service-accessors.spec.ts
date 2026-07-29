import { ConfigService, Config } from '../../src/config/config.service';

/**
 * Tests ConfigService's own accessors directly against a small fake
 * NestConfigService, instead of a compiled Nest module (see #491 — that
 * module route is fragile because @nestjs/config validates once at import,
 * so per-test environments don't take effect there).
 */
function buildService(env: Partial<Config>): ConfigService {
  const fakeNestConfigService = {
    get: (key: string) => (env as Record<string, unknown>)[key],
  };
  return new ConfigService(fakeNestConfigService as never);
}

describe('ConfigService.getAllowedOrigins', () => {
  it('returns an empty array when ALLOWED_ORIGINS is unset', () => {
    const service = buildService({});
    expect(service.getAllowedOrigins()).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    const service = buildService({ ALLOWED_ORIGINS: '' });
    expect(service.getAllowedOrigins()).toEqual([]);
  });

  it('returns a single origin', () => {
    const service = buildService({
      ALLOWED_ORIGINS: 'https://app.example.com',
    });
    expect(service.getAllowedOrigins()).toEqual(['https://app.example.com']);
  });

  it('returns several comma-separated origins', () => {
    const service = buildService({
      ALLOWED_ORIGINS: 'https://a.example.com,https://b.example.com',
    });
    expect(service.getAllowedOrigins()).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('trims surrounding whitespace around each origin', () => {
    const service = buildService({
      ALLOWED_ORIGINS: ' https://a.example.com , https://b.example.com ',
    });
    expect(service.getAllowedOrigins()).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});

describe('ConfigService.isProduction / isDevelopment / isTest', () => {
  it('isProduction is true for NODE_ENV=production', () => {
    expect(buildService({ NODE_ENV: 'production' }).isProduction()).toBe(true);
  });

  it('isProduction is false for NODE_ENV=test', () => {
    expect(buildService({ NODE_ENV: 'test' }).isProduction()).toBe(false);
  });

  it('isProduction is false for NODE_ENV=development', () => {
    expect(buildService({ NODE_ENV: 'development' }).isProduction()).toBe(
      false,
    );
  });

  it('isProduction is false when NODE_ENV is unset', () => {
    expect(buildService({}).isProduction()).toBe(false);
  });

  it('isDevelopment / isTest agree with the same NODE_ENV values', () => {
    expect(buildService({ NODE_ENV: 'development' }).isDevelopment()).toBe(
      true,
    );
    expect(buildService({ NODE_ENV: 'test' }).isTest()).toBe(true);
    expect(buildService({ NODE_ENV: 'production' }).isDevelopment()).toBe(
      false,
    );
  });
});

describe('ConfigService database pool accessors (getDatabaseUrl)', () => {
  const base = 'postgresql://user:pass@localhost:5432/db';

  it('returns the base URL unchanged when no pool settings are supplied (default)', () => {
    const service = buildService({ DATABASE_URL: base });
    expect(service.getDatabaseUrl()).toBe(base);
  });

  it('appends connection_limit when DB_POOL_CONNECTION_LIMIT is supplied', () => {
    const service = buildService({
      DATABASE_URL: base,
      DB_POOL_CONNECTION_LIMIT: 25,
    });
    const url = new URL(service.getDatabaseUrl());
    expect(url.searchParams.get('connection_limit')).toBe('25');
  });

  it('appends pool_timeout (converted from ms to seconds) when DB_POOL_TIMEOUT_MS is supplied', () => {
    const service = buildService({
      DATABASE_URL: base,
      DB_POOL_TIMEOUT_MS: 15000,
    });
    const url = new URL(service.getDatabaseUrl());
    expect(url.searchParams.get('pool_timeout')).toBe('15');
  });

  it('appends both when both pool settings are supplied', () => {
    const service = buildService({
      DATABASE_URL: base,
      DB_POOL_CONNECTION_LIMIT: 5,
      DB_POOL_TIMEOUT_MS: 3000,
    });
    const url = new URL(service.getDatabaseUrl());
    expect(url.searchParams.get('connection_limit')).toBe('5');
    expect(url.searchParams.get('pool_timeout')).toBe('3');
  });
});
