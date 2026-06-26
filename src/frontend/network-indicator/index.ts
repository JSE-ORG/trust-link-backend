/**
 * Barrel export for the network-indicator feature.
 *
 * This file only re-exports the framework-agnostic utility so that the
 * NestJS backend tsconfig (which has no `jsx` flag) can compile it cleanly.
 *
 * React component files (NetworkIndicator.tsx, NetworkBanner.tsx) must be
 * consumed from a Next.js project whose tsconfig.json includes:
 *   { "compilerOptions": { "jsx": "react-jsx" } }
 *
 * Next.js usage:
 *   import { NetworkIndicator, NetworkBanner } from './NetworkIndicator';
 *   import { NetworkBanner }                   from './NetworkBanner';
 *   import { resolveNetwork, getNetworkConfig } from './network-indicator.util';
 */

export { resolveNetwork, getNetworkConfig } from './network-indicator.util';
export type { StellarNetwork, NetworkConfig } from './network-indicator.util';
