import { Injectable } from '@nestjs/common';
import axios from 'axios';

export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

export interface HorizonConfig {
  getStellarHorizonUrl(): string;
}

/**
 * HorizonService reads STELLAR_HORIZON_URL from an injected HorizonConfig
 * instead of hard-coding the testnet URL (issue #291).  Falls back to the
 * testnet default when the environment variable is absent.
 */
@Injectable()
export class HorizonService {
  readonly horizonUrl: string;
  private readonly pollIntervalMs = 100;

  constructor(config?: HorizonConfig) {
    this.horizonUrl =
      (config?.getStellarHorizonUrl() || process.env.STELLAR_HORIZON_URL) ??
      DEFAULT_HORIZON_URL;
  }

  getHorizonUrl(): string {
    return this.horizonUrl;
  }

  async pollConfirmation(
    transactionHash: string,
    targetConfirmations = 3,
    timeoutMs = 10000,
  ): Promise<{ confirmed: boolean; confirmations: number; hash: string }> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await axios.get<{ confirmations?: number }>(
          `${this.horizonUrl}/transactions/${encodeURIComponent(
            transactionHash,
          )}`,
        );

        if (response.status !== 200) {
          throw new Error(`Horizon responded with ${response.status}`);
        }

        const confirmations = Number(response.data?.confirmations ?? 0);
        if (confirmations >= targetConfirmations) {
          return {
            confirmed: true,
            confirmations,
            hash: transactionHash,
          };
        }
      } catch {
        if (Date.now() - start >= timeoutMs) {
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new Error('Horizon confirmation timed out');
  }
}
