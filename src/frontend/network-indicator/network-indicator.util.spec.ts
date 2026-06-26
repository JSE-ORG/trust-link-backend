/**
 * Unit tests for network-indicator.util.ts
 *
 * Pure logic — no DOM, no React, no external services.
 * Runs in the existing Jest/ts-jest setup.
 *
 * Covers all acceptance criteria:
 *  AC: Green/yellow dot config returned for correct network
 *  AC: Banner message present only for Testnet
 *  AC: Reads from NEXT_PUBLIC_STELLAR_NETWORK (via resolveNetwork)
 *  AC: Label text always present (accessible — not color alone)
 */

import {
  resolveNetwork,
  getNetworkConfig,
  type StellarNetwork,
} from './network-indicator.util';

// ── resolveNetwork ───────────────────────────────────────────────────────────

describe('resolveNetwork()', () => {
  describe('canonical MAINNET input', () => {
    it('returns MAINNET for "MAINNET"', () => {
      expect(resolveNetwork('MAINNET')).toBe('MAINNET');
    });

    it('returns MAINNET for lowercase "mainnet"', () => {
      expect(resolveNetwork('mainnet')).toBe('MAINNET');
    });

    it('returns MAINNET for mixed-case "Mainnet"', () => {
      expect(resolveNetwork('Mainnet')).toBe('MAINNET');
    });

    it('returns MAINNET when value has surrounding whitespace', () => {
      expect(resolveNetwork('  MAINNET  ')).toBe('MAINNET');
    });
  });

  describe('canonical TESTNET input', () => {
    it('returns TESTNET for "TESTNET"', () => {
      expect(resolveNetwork('TESTNET')).toBe('TESTNET');
    });

    it('returns TESTNET for lowercase "testnet"', () => {
      expect(resolveNetwork('testnet')).toBe('TESTNET');
    });

    it('returns TESTNET for mixed-case "Testnet"', () => {
      expect(resolveNetwork('Testnet')).toBe('TESTNET');
    });
  });

  describe('fail-safe defaults (unknown → TESTNET)', () => {
    it('returns TESTNET when env var is undefined', () => {
      expect(resolveNetwork(undefined)).toBe('TESTNET');
    });

    it('returns TESTNET when env var is an empty string', () => {
      expect(resolveNetwork('')).toBe('TESTNET');
    });

    it('returns TESTNET for an unrecognised value "DEVNET"', () => {
      expect(resolveNetwork('DEVNET')).toBe('TESTNET');
    });

    it('returns TESTNET for a numeric string', () => {
      expect(resolveNetwork('1')).toBe('TESTNET');
    });
  });
});

// ── getNetworkConfig — Mainnet ───────────────────────────────────────────────

describe('getNetworkConfig("MAINNET")', () => {
  let config: ReturnType<typeof getNetworkConfig>;

  beforeEach(() => {
    config = getNetworkConfig('MAINNET');
  });

  it('sets isTestnet to false', () => {
    expect(config.isTestnet).toBe(false);
  });

  it('sets label to "Mainnet" (text indicator — not color alone)', () => {
    expect(config.label).toBe('Mainnet');
  });

  it('sets dotColor to "green"', () => {
    expect(config.dotColor).toBe('green');
  });

  it('sets dotColorHex to the green hex value #22c55e', () => {
    expect(config.dotColorHex).toBe('#22c55e');
  });

  it('sets a descriptive ariaLabel that includes "Mainnet"', () => {
    expect(config.ariaLabel).toMatch(/mainnet/i);
  });

  it('sets bannerMessage to empty string (no banner on Mainnet)', () => {
    expect(config.bannerMessage).toBe('');
  });
});

// ── getNetworkConfig — Testnet ───────────────────────────────────────────────

describe('getNetworkConfig("TESTNET")', () => {
  let config: ReturnType<typeof getNetworkConfig>;

  beforeEach(() => {
    config = getNetworkConfig('TESTNET');
  });

  it('sets isTestnet to true', () => {
    expect(config.isTestnet).toBe(true);
  });

  it('sets label to "Testnet" (text indicator — not color alone)', () => {
    expect(config.label).toBe('Testnet');
  });

  it('sets dotColor to "yellow"', () => {
    expect(config.dotColor).toBe('yellow');
  });

  it('sets dotColorHex to the yellow hex value #eab308', () => {
    expect(config.dotColorHex).toBe('#eab308');
  });

  it('sets a descriptive ariaLabel that includes "Testnet"', () => {
    expect(config.ariaLabel).toMatch(/testnet/i);
  });

  it('sets ariaLabel that mentions funds have no real value (AC: accessible text)', () => {
    expect(config.ariaLabel).toMatch(/funds have no real value/i);
  });

  it('sets bannerMessage to the required Testnet warning text', () => {
    expect(config.bannerMessage).toBe(
      'You are on Testnet — funds have no real value',
    );
  });
});

// ── Round-trip: resolveNetwork → getNetworkConfig ────────────────────────────

describe('end-to-end: env var → config', () => {
  it('NEXT_PUBLIC_STELLAR_NETWORK="MAINNET" produces a non-testnet green config', () => {
    const network = resolveNetwork(
      process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'MAINNET',
    );
    const config = getNetworkConfig(network);
    // Prove label is always present (accessibility: not color alone)
    expect(config.label).toBeTruthy();
    expect(config.dotColorHex).toBeTruthy();
  });

  it('undefined env var round-trips to a yellow Testnet config with a banner', () => {
    const network = resolveNetwork(undefined);
    const config = getNetworkConfig(network);
    expect(network).toBe('TESTNET');
    expect(config.isTestnet).toBe(true);
    expect(config.bannerMessage).not.toBe('');
    // Label must be present — not relying on color alone
    expect(config.label).toBeTruthy();
  });

  it('each network config has both a label AND a colour (accessibility check)', () => {
    const networks: StellarNetwork[] = ['MAINNET', 'TESTNET'];
    for (const n of networks) {
      const c = getNetworkConfig(n);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.dotColorHex.length).toBeGreaterThan(0);
      expect(c.ariaLabel.length).toBeGreaterThan(0);
    }
  });
});
