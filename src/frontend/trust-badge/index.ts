/**
 * Barrel export for the trust-badge feature.
 *
 * Re-exports only the framework-agnostic utility so the NestJS backend
 * tsconfig (no JSX flag) compiles cleanly.
 *
 * For the React component, import directly in Next.js:
 *   import { TrustBadge } from './TrustBadge';
 */

export {
  truncateAddress,
  getExplorerUrl,
  resolveNetwork,
  copyToClipboard,
} from './trust-badge.util';

export type { StellarNetwork } from './trust-badge.util';
