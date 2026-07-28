export interface CspConnectSourceConfig {
  stellarNetwork: 'TESTNET' | 'MAINNET';
  stellarHorizonUrl?: string;
  sentryDsn?: string;
  otelExporterOtlpEndpoint?: string;
  logisticsApiBaseUrl?: string;
  extraConnectSrc?: string;
}

const DEFAULT_HORIZON_URLS: Record<'TESTNET' | 'MAINNET', string> = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
};

export function buildCspConnectSrc(config: CspConnectSourceConfig): string[] {
  const sources = new Set<string>([`'self'`]);

  addOrigin(
    sources,
    config.stellarHorizonUrl ?? DEFAULT_HORIZON_URLS[config.stellarNetwork],
  );
  addOrigin(sources, config.sentryDsn);
  addOrigin(sources, config.otelExporterOtlpEndpoint);
  addOrigin(sources, config.logisticsApiBaseUrl);

  for (const rawSource of parseCsv(config.extraConnectSrc)) {
    if (rawSource === `'self'`) {
      sources.add(rawSource);
      continue;
    }
    addOrigin(sources, rawSource);
  }

  return [...sources];
}

function parseCsv(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function addOrigin(sources: Set<string>, rawUrl?: string): void {
  if (!rawUrl) return;

  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      sources.add(url.origin);
    }
  } catch {
    // Ignore invalid values rather than accidentally broadening CSP.
  }
}
