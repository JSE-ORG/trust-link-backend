import { Injectable } from '@nestjs/common';

export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

export interface HorizonConfig {
  getStellarHorizonUrl(): string;
}

/**
 * HorizonService reads the Stellar Horizon base URL from an injected config
 * source instead of hard-coding the testnet URL (issue #291).
 *
 * Defaults to the testnet URL when STELLAR_HORIZON_URL is not provided so
 * local development and CI continue to work without any extra configuration.
 */
@Injectable()
export class HorizonService {
  private readonly horizonUrl: string;

  constructor(config: HorizonConfig) {
    this.horizonUrl = config.getStellarHorizonUrl() || DEFAULT_HORIZON_URL;
  }

  getHorizonUrl(): string {
    return this.horizonUrl;
  }

  /**
   * Poll Horizon for a transaction by hash. Returns the transaction object
   * when found, or null if the transaction is not yet confirmed.
   */
  async getTransaction(txHash: string): Promise<Record<string, unknown> | null> {
    const url = `${this.horizonUrl}/transactions/${txHash}`;
    const res = await fetch(url);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Horizon responded with ${res.status} for tx ${txHash}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }
}
