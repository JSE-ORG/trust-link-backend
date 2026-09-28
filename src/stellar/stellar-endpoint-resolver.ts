import { ConfigService } from '../config/config.service';
import { STELLAR_RPC_URLS } from './stellar-endpoints';

export function resolveStellarServerRpcUrl(config: ConfigService): string {
  return (
    config.get('SOROBAN_RPC_URL') ||
    (config.get('STELLAR_NETWORK') === 'MAINNET'
      ? STELLAR_RPC_URLS.MAINNET
      : STELLAR_RPC_URLS.TESTNET)
  );
}
