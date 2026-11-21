export const DEFAULT_SUPPORTED_CURRENCIES = 'USDC';

export function parseSupportedCurrencies(raw: string): string[] {
  return raw
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export function supportedCurrencies(): string[] {
  return parseSupportedCurrencies(
    process.env.SUPPORTED_CURRENCIES ?? DEFAULT_SUPPORTED_CURRENCIES,
  );
}
