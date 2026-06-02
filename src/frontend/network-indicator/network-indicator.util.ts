/**
 * Pure-logic utilities for the network indicator feature.
 *
 * Zero external dependencies — designed to be tested in Node/Jest
 * without a DOM or React runtime.
 *
 * The env var `NEXT_PUBLIC_STELLAR_NETWORK` follows Next.js conventions:
 * only values prefixed with NEXT_PUBLIC_ are inlined into the client bundle.
 */

/** The two supported Stellar network identifiers. */
export type StellarNetwork = 'MAINNET' | 'TESTNET';

/**
 * Configuration object derived from the resolved network.
 * All visual and semantic properties are expressed here so components
 * remain pure presentational wrappers.
 */
export interface NetworkConfig {
  /** Human-readable label rendered alongside the dot. */
  label: string;
  /** CSS colour name used as a fallback / utility class hint. */
  dotColor: 'green' | 'yellow';
  /**
   * Hex colour value for the status dot.
   * Green (#22c55e) = Mainnet, Yellow (#eab308) = Testnet.
   * Contrast against white/dark backgrounds meets WCAG AA for non-text use.
   */
  dotColorHex: string;
  /** Full accessible label for screen readers (not color-only). */
  ariaLabel: string;
  /** True when the network is Testnet — drives banner visibility. */
  isTestnet: boolean;
  /** Warning message shown in the testnet banner. */
  bannerMessage: string;
}

const MAINNET_CONFIG: NetworkConfig = {
  label: 'Mainnet',
  dotColor: 'green',
  dotColorHex: '#22c55e',
  ariaLabel: 'Connected to Mainnet',
  isTestnet: false,
  bannerMessage: '',
};

const TESTNET_CONFIG: NetworkConfig = {
  label: 'Testnet',
  dotColor: 'yellow',
  dotColorHex: '#eab308',
  ariaLabel: 'Connected to Testnet — funds have no real value',
  isTestnet: true,
  bannerMessage: 'You are on Testnet — funds have no real value',
};

/**
 * Normalises the raw `NEXT_PUBLIC_STELLAR_NETWORK` env var value to a
 * canonical `StellarNetwork` union type.
 *
 * - Accepts case-insensitive "MAINNET" / "mainnet".
 * - Defaults to `'TESTNET'` for any unrecognised value or undefined input
 *   (fail-safe: unknown network should never be treated as production).
 *
 * @param raw - Value of `process.env.NEXT_PUBLIC_STELLAR_NETWORK`
 */
export function resolveNetwork(raw: string | undefined): StellarNetwork {
  if (!raw) return 'TESTNET';
  switch (raw.toUpperCase().trim()) {
    case 'MAINNET':
      return 'MAINNET';
    case 'TESTNET':
      return 'TESTNET';
    default:
      return 'TESTNET';
  }
}

/**
 * Returns the full display + accessibility configuration for the given
 * resolved network.
 *
 * @param network - A `StellarNetwork` value returned by `resolveNetwork`
 */
export function getNetworkConfig(network: StellarNetwork): NetworkConfig {
  return network === 'MAINNET' ? MAINNET_CONFIG : TESTNET_CONFIG;
}
