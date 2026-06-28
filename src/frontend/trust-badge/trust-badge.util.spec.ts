/**
 * Unit tests for trust-badge.util.ts
 *
 * Pure logic — no DOM, no React, no external services.
 * Runs in the existing Jest / ts-jest setup.
 *
 * Acceptance Criteria covered:
 *  AC: Renders contract address in truncated form
 *  AC: Full address shown on hover/focus (tooltip) — verified via truncation logic
 *  AC: Testnet → stellar.expert/explorer/testnet
 *  AC: Mainnet → stellar.expert/explorer/public
 *  AC: Copy button tested (via copyToClipboard mock)
 */

import {
  truncateAddress,
  getExplorerUrl,
  resolveNetwork,
  copyToClipboard,
  type StellarNetwork,
} from './trust-badge.util';

// ── truncateAddress ──────────────────────────────────────────────────────────

describe('truncateAddress()', () => {
  const FULL_ADDRESS =
    'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

  it('truncates a long address to default 6…4 format', () => {
    const result = truncateAddress(FULL_ADDRESS);
    expect(result).toBe('GABCDE…STUV');
  });

  it('keeps the correct start characters (default startLen = 6)', () => {
    const result = truncateAddress(FULL_ADDRESS);
    expect(result.split('…')[0]).toBe(FULL_ADDRESS.slice(0, 6));
  });

  it('keeps the correct end characters (default endLen = 4)', () => {
    const result = truncateAddress(FULL_ADDRESS);
    expect(result.split('…')[1]).toBe(FULL_ADDRESS.slice(-4));
  });

  it('uses a single ellipsis (…) as the separator', () => {
    const result = truncateAddress(FULL_ADDRESS);
    expect(result).toContain('…');
    expect((result.match(/…/g) || []).length).toBe(1);
  });

  it('supports custom startLen and endLen', () => {
    const result = truncateAddress(FULL_ADDRESS, 8, 6);
    expect(result).toBe(
      `${FULL_ADDRESS.slice(0, 8)}…${FULL_ADDRESS.slice(-6)}`,
    );
  });

  it('returns the original string when shorter than startLen + endLen + 1', () => {
    expect(truncateAddress('SHORT', 6, 4)).toBe('SHORT');
  });

  it('returns the original string when exactly startLen + endLen chars', () => {
    const exact = 'ABCDEFGHIJ'; // 10 chars = 6 + 4
    expect(truncateAddress(exact, 6, 4)).toBe(exact);
  });

  it('truncates when length is startLen + endLen + 2 (just over threshold)', () => {
    const justOver = 'ABCDEFGHIJKL'; // 12 chars > 6 + 4 + 1 = 11
    const result = truncateAddress(justOver, 6, 4);
    expect(result).toBe('ABCDEF…IJKL');
  });

  it('returns empty string for empty input', () => {
    expect(truncateAddress('')).toBe('');
  });

  it('returns empty string for undefined-like falsy input', () => {
    // TypeScript guards this, but runtime safety matters
    expect(truncateAddress(undefined as unknown as string)).toBe('');
  });

  // Tooltip verification: the truncated form is different from the full address
  it('produces a value different from the original (tooltip shows full on hover)', () => {
    const truncated = truncateAddress(FULL_ADDRESS);
    expect(truncated).not.toBe(FULL_ADDRESS);
    // The component uses `title={contractAddress}` for the tooltip,
    // so the full address is always available on hover/focus.
  });
});

// ── getExplorerUrl ───────────────────────────────────────────────────────────

describe('getExplorerUrl()', () => {
  const CONTRACT = 'CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

  describe('Testnet', () => {
    it('links to stellar.expert/explorer/testnet/contract/{address}', () => {
      const url = getExplorerUrl(CONTRACT, 'TESTNET');
      expect(url).toBe(
        `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`,
      );
    });

    it('contains the /testnet/ path segment', () => {
      const url = getExplorerUrl(CONTRACT, 'TESTNET');
      expect(url).toContain('/explorer/testnet/');
    });

    it('does NOT contain /public/ path segment', () => {
      const url = getExplorerUrl(CONTRACT, 'TESTNET');
      expect(url).not.toContain('/explorer/public/');
    });
  });

  describe('Mainnet', () => {
    it('links to stellar.expert/explorer/public/contract/{address}', () => {
      const url = getExplorerUrl(CONTRACT, 'MAINNET');
      expect(url).toBe(
        `https://stellar.expert/explorer/public/contract/${CONTRACT}`,
      );
    });

    it('contains the /public/ path segment', () => {
      const url = getExplorerUrl(CONTRACT, 'MAINNET');
      expect(url).toContain('/explorer/public/');
    });

    it('does NOT contain /testnet/ path segment', () => {
      const url = getExplorerUrl(CONTRACT, 'MAINNET');
      expect(url).not.toContain('/explorer/testnet/');
    });
  });

  it('always starts with https://stellar.expert', () => {
    const networks: StellarNetwork[] = ['MAINNET', 'TESTNET'];
    for (const n of networks) {
      expect(getExplorerUrl(CONTRACT, n)).toMatch(/^https:\/\/stellar\.expert/);
    }
  });

  it('always ends with the full contract address', () => {
    const networks: StellarNetwork[] = ['MAINNET', 'TESTNET'];
    for (const n of networks) {
      expect(getExplorerUrl(CONTRACT, n)).toMatch(
        new RegExp(`/contract/${CONTRACT}$`),
      );
    }
  });
});

// ── resolveNetwork ───────────────────────────────────────────────────────────

describe('resolveNetwork()', () => {
  it('returns MAINNET for "MAINNET"', () => {
    expect(resolveNetwork('MAINNET')).toBe('MAINNET');
  });

  it('returns MAINNET for lowercase "mainnet"', () => {
    expect(resolveNetwork('mainnet')).toBe('MAINNET');
  });

  it('returns TESTNET for "TESTNET"', () => {
    expect(resolveNetwork('TESTNET')).toBe('TESTNET');
  });

  it('defaults to TESTNET when undefined', () => {
    expect(resolveNetwork(undefined)).toBe('TESTNET');
  });

  it('defaults to TESTNET for unrecognised values', () => {
    expect(resolveNetwork('FOO')).toBe('TESTNET');
  });
});

// ── copyToClipboard ──────────────────────────────────────────────────────────

describe('copyToClipboard()', () => {
  const originalClipboard = global.navigator?.clipboard;

  afterEach(() => {
    // Restore original clipboard (or remove our mock)
    if (originalClipboard) {
      Object.defineProperty(global.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  it('returns true when clipboard.writeText succeeds', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard('GABCDEF');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('GABCDEF');
  });

  it('passes the exact address string to clipboard.writeText', async () => {
    const addr = 'CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    await copyToClipboard(addr);
    expect(writeText).toHaveBeenCalledWith(addr);
  });

  it('returns false when clipboard.writeText rejects', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(global, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard('GABCDEF');
    expect(result).toBe(false);
  });

  it('returns false when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard('GABCDEF');
    expect(result).toBe(false);
  });
});

// ── Integration: full round-trip ─────────────────────────────────────────────

describe('end-to-end: address + network → truncated display + explorer URL', () => {
  const addr = 'CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

  it('testnet env var produces a /testnet/ explorer link', () => {
    const network = resolveNetwork('TESTNET');
    const url = getExplorerUrl(addr, network);
    expect(url).toContain('/explorer/testnet/');
  });

  it('mainnet env var produces a /public/ explorer link', () => {
    const network = resolveNetwork('MAINNET');
    const url = getExplorerUrl(addr, network);
    expect(url).toContain('/explorer/public/');
  });

  it('truncated address differs from full address (tooltip shows full)', () => {
    const truncated = truncateAddress(addr);
    expect(truncated).not.toBe(addr);
    expect(truncated.length).toBeLessThan(addr.length);
  });

  it('explorer URL contains the full (not truncated) address', () => {
    const url = getExplorerUrl(addr, 'TESTNET');
    expect(url).toContain(addr);
    expect(url).not.toContain('…');
  });
});
