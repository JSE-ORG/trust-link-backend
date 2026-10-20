/** Default public Stellar endpoints, selected by network when no override is configured. */
export const STELLAR_RPC_URLS = {
  TESTNET: 'https://soroban-testnet.stellar.org',
  MAINNET: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
} as const;

export const STELLAR_HORIZON_URLS = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
} as const;
