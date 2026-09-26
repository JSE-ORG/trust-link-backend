import { buildCspConnectSrc } from './csp.config';

describe('buildCspConnectSrc', () => {
  it('allows self and the configured Stellar Horizon origin', () => {
    expect(
      buildCspConnectSrc({
        stellarNetwork: 'TESTNET',
        stellarHorizonUrl: 'https://horizon.example.test/path',
      }),
    ).toEqual([`'self'`, 'https://horizon.example.test']);
  });

  it('does not include wildcard Stellar origins', () => {
    const sources = buildCspConnectSrc({ stellarNetwork: 'MAINNET' });

    expect(sources).toContain(`'self'`);
    expect(sources).toContain('https://horizon.stellar.org');
    expect(sources).not.toContain('https://*.stellar.org');
  });

  it('allows required service origins and configurable development origins', () => {
    expect(
      buildCspConnectSrc({
        stellarNetwork: 'TESTNET',
        sentryDsn: 'https://abc@sentry.example/123',
        otelExporterOtlpEndpoint: 'https://otel.example/v1/traces',
        logisticsApiBaseUrl: 'https://logistics.example/api',
        extraConnectSrc: 'http://localhost:3001, https://dev-api.example/v1',
      }),
    ).toEqual([
      `'self'`,
      'https://horizon-testnet.stellar.org',
      'https://sentry.example',
      'https://otel.example',
      'https://logistics.example',
      'http://localhost:3001',
      'https://dev-api.example',
    ]);
  });

  it("passes the 'self' keyword through unchanged without treating it as a URL", () => {
    const sources = buildCspConnectSrc({
      stellarNetwork: 'TESTNET',
      extraConnectSrc: `'self'`,
    });
    expect(sources).toContain(`'self'`);
    expect(sources.filter((s) => s === `'self'`)).toHaveLength(1);
  });

  it('rejects a non-http(s) scheme from extraConnectSrc', () => {
    const sources = buildCspConnectSrc({
      stellarNetwork: 'TESTNET',
      extraConnectSrc: 'ftp://files.example.com',
    });
    expect(sources).not.toContain('ftp://files.example.com');
    expect(sources.some((s) => s.startsWith('ftp:'))).toBe(false);
  });
});
