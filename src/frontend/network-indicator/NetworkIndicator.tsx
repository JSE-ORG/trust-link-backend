/**
 * NetworkIndicator — React component for the app header.
 *
 * Displays a coloured status dot + text label indicating whether the app is
 * connected to Mainnet or Testnet.
 *
 * Accessibility:
 *  - Color is NEVER the sole indicator; the text label is always visible.
 *  - `role="status"` announces changes to assistive technologies.
 *  - `aria-label` provides a full description that includes the network name.
 *
 * Usage (Next.js layout.tsx / _app.tsx):
 *   import { NetworkIndicator } from '@/components/network-indicator';
 *   <NetworkIndicator network={process.env.NEXT_PUBLIC_STELLAR_NETWORK} />
 */

import React from 'react';
import { resolveNetwork, getNetworkConfig } from './network-indicator.util';

export interface NetworkIndicatorProps {
  /**
   * Raw value of `process.env.NEXT_PUBLIC_STELLAR_NETWORK`.
   * Accepts undefined (defaults to Testnet — fail-safe).
   */
  network?: string;
}

export function NetworkIndicator({ network }: NetworkIndicatorProps) {
  const resolved = resolveNetwork(network);
  const config = getNetworkConfig(resolved);

  return (
    <div
      role="status"
      aria-label={config.ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '9999px',
        border: `1.5px solid ${config.dotColorHex}`,
        backgroundColor: 'transparent',
        fontSize: '0.8125rem',  /* 13px */
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {/* Status dot — purely decorative; label carries the meaning */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: config.dotColorHex,
          flexShrink: 0,
        }}
      />
      {/* Text label — ensures color is NOT the sole indicator */}
      <span>{config.label}</span>
    </div>
  );
}
