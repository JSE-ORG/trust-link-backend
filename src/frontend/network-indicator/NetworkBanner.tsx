/**
 * NetworkBanner — renders a full-width warning strip when on Testnet.
 *
 * Accessibility:
 *  - `role="alert"` causes immediate announcement to screen readers.
 *  - Warning icon (⚠) is marked `aria-hidden`; the text carries all meaning.
 *  - High-contrast yellow (#fef08a bg, #713f12 text) — WCAG AA ≥ 4.5:1.
 *  - Renders null on Mainnet — zero DOM footprint in production.
 *
 * Usage (place above or below <Header> in layout.tsx):
 *   import { NetworkBanner } from '@/components/network-indicator';
 *   <NetworkBanner network={process.env.NEXT_PUBLIC_STELLAR_NETWORK} />
 */

import React from 'react';
import { resolveNetwork, getNetworkConfig } from './network-indicator.util';

export interface NetworkBannerProps {
  /** Raw value of `process.env.NEXT_PUBLIC_STELLAR_NETWORK`. */
  network?: string;
}

export function NetworkBanner({ network }: NetworkBannerProps) {
  const resolved = resolveNetwork(network);
  const config = getNetworkConfig(resolved);

  // Renders nothing on Mainnet
  if (!config.isTestnet) return null;

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        padding: '10px 16px',
        backgroundColor: '#fef08a',   /* yellow-200 — WCAG AA contrast */
        color: '#713f12',              /* yellow-900 — contrast ratio ≥ 7:1 */
        fontSize: '0.875rem',          /* 14px */
        fontWeight: 500,
        lineHeight: 1.4,
        boxSizing: 'border-box',
      }}
    >
      {/* Icon is decorative — text carries full meaning for screen readers */}
      <span aria-hidden="true" style={{ fontSize: '1rem' }}>⚠</span>
      <span>{config.bannerMessage}</span>
    </div>
  );
}
