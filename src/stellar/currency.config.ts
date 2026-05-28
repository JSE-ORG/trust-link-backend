export interface AssetConfig {
  code: string;
  issuer: string | null;
  decimals: number;
  contractId?: string;
}

export const SUPPORTED_ASSETS: Record<string, AssetConfig> = {
  XLM: {
    code: 'XLM',
    issuer: null,
    decimals: 7,
  },
  USDC: {
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    decimals: 7,
    contractId: process.env.USDC_CONTRACT_ID,
  },
  cNGN: {
    code: 'cNGN',
    issuer: process.env.CNGN_ISSUER ?? '',
    decimals: 2,
    contractId: process.env.CNGN_CONTRACT_ID,
  },
};

export function formatBalance(rawAmount: bigint | string, decimals: number): string {
  const raw = BigInt(rawAmount);
  const factor = BigInt(10 ** decimals);
  const whole = raw / factor;
  const frac = raw % factor;
  return `${whole}.${frac.toString().padStart(decimals, '0')}`;
}

export function getAsset(code: string): AssetConfig {
  const asset = SUPPORTED_ASSETS[code.toUpperCase()];
  if (!asset) throw new Error(`Unsupported asset: ${code}`);
  return asset;
}
