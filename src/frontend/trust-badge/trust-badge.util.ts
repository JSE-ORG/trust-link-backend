/**
 * Pure-logic utilities for the TrustBadge component.
 *
 * Zero external dependencies — fully testable via Jest without DOM or React.
 */

/** Supported Stellar network identifiers. */
export type StellarNetwork = 'MAINNET' | 'TESTNET';

/**
 * Truncates a Stellar address for compact display.
 *
 * Example: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567" → "GABCDE…4567"
 *
 * @param address  - Full Stellar public key or contract address.
 * @param startLen - Number of characters to keep at the start (default 6).
 * @param endLen   - Number of characters to keep at the end (default 4).
 * @returns Truncated string with an ellipsis (…) in the middle,
 *          or the original string if it's shorter than startLen + endLen + 1.
 */
export function truncateAddress(
  address: string,
  startLen = 6,
  endLen = 4,
): string {
  if (!address) return '';
  if (address.length <= startLen + endLen + 1) return address;
  return `${address.slice(0, startLen)}…${address.slice(-endLen)}`;
}

/**
 * Builds the Stellar Expert explorer URL for a given contract address.
 *
 * - Testnet  → https://stellar.expert/explorer/testnet/contract/{address}
 * - Mainnet  → https://stellar.expert/explorer/public/contract/{address}
 *
 * @param address - Full Stellar contract address.
 * @param network - Which Stellar network to link to.
 */
export function getExplorerUrl(
  address: string,
  network: StellarNetwork,
): string {
  const segment = network === 'MAINNET' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${segment}/contract/${address}`;
}

/**
 * Resolves a raw env var value to a canonical StellarNetwork.
 * Defaults to TESTNET for safety (same logic as network-indicator).
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
 * Copies text to the clipboard.
 *
 * Returns true on success, false on failure.
 * This thin wrapper exists so tests can mock `navigator.clipboard`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
