/**
 * TrustBadge — React component displaying a Stellar contract address.
 *
 * Features:
 *  - Truncated address display (e.g. "GABCDE…4567")
 *  - Full address shown on hover/focus via HTML `title` tooltip
 *  - Links to the correct Stellar Expert explorer (testnet vs mainnet)
 *  - Copy-to-clipboard button
 *  - Accessible: aria-labels on all interactive elements
 *
 * Usage (Next.js):
 *   import { TrustBadge } from '@/components/trust-badge/TrustBadge';
 *   <TrustBadge
 *     contractAddress="CABCDEF..."
 *     network={process.env.NEXT_PUBLIC_STELLAR_NETWORK}
 *   />
 */

import React, { useState, useCallback } from 'react';
import {
  truncateAddress,
  getExplorerUrl,
  resolveNetwork,
  copyToClipboard,
} from './trust-badge.util';

export interface TrustBadgeProps {
  /** Full Stellar contract address. */
  contractAddress: string;
  /** Raw value of NEXT_PUBLIC_STELLAR_NETWORK (defaults to Testnet). */
  network?: string;
}

export function TrustBadge({ contractAddress, network }: TrustBadgeProps) {
  const [copied, setCopied] = useState(false);
  const resolved = resolveNetwork(network);
  const explorerUrl = getExplorerUrl(contractAddress, resolved);
  const truncated = truncateAddress(contractAddress);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(contractAddress);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [contractAddress]);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 12px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#f8fafc',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: '0.8125rem',
        lineHeight: 1,
      }}
    >
      {/* Address link — tooltip shows full address on hover/focus */}
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={contractAddress}
        aria-label={`View contract ${contractAddress} on Stellar Expert (${resolved === 'MAINNET' ? 'Mainnet' : 'Testnet'})`}
        style={{
          color: '#3b82f6',
          textDecoration: 'none',
          outline: 'none',
        }}
        onFocus={(e) => (e.currentTarget.style.textDecoration = 'underline')}
        onBlur={(e) => (e.currentTarget.style.textDecoration = 'none')}
      >
        {truncated}
      </a>

      {/* Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied!' : `Copy contract address ${contractAddress}`}
        title={copied ? 'Copied!' : 'Copy address'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          padding: 0,
          border: 'none',
          borderRadius: '4px',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '0.875rem',
          color: copied ? '#22c55e' : '#64748b',
          transition: 'color 150ms',
        }}
      >
        {copied ? '✓' : '📋'}
      </button>
    </span>
  );
}
