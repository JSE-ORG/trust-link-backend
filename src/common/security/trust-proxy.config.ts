import { isIP } from 'node:net';

/**
 * Value handed to Express's `trust proxy` setting: a hop count, or a list of
 * addresses, CIDR ranges and named presets that identify trusted proxies.
 */
export type TrustProxySetting = number | string[];

/** Express's named presets for private and loopback address ranges. */
const TRUST_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

export const TRUST_PROXY_ERROR =
  'Config validation error: TRUST_PROXY must be a positive hop count (e.g. 1), ' +
  'or a comma-separated list of IP addresses, CIDR ranges, or the presets ' +
  'loopback, linklocal and uniquelocal';

/**
 * Parses TRUST_PROXY (issue #971). Returns `null` when the value is invalid,
 * so the Joi schema can reject it at boot.
 *
 * Trust is off unless this is set. Trusting `X-Forwarded-For` with no proxy in
 * front lets any client choose its own IP, so there is deliberately no default.
 */
export function parseTrustProxy(raw: string): TrustProxySetting | null {
  const value = raw.trim();

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops >= 1 ? hops : null;
  }

  const entries = value.split(',').map((entry) => entry.trim());
  return entries.every(isTrustedProxyEntry) ? entries : null;
}

function isTrustedProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_PRESETS.has(entry) || isIP(entry) !== 0) {
    return true;
  }

  const [address, prefix, ...rest] = entry.split('/');
  if (!address || prefix === undefined || rest.length > 0) {
    return false;
  }
  if (!/^\d+$/.test(prefix)) {
    return false;
  }

  const family = isIP(address);
  const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;
  return maxPrefix >= 0 && Number(prefix) <= maxPrefix;
}
