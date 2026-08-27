import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';

export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

const HORIZON_URLS: Record<'TESTNET' | 'MAINNET', string> = {
  TESTNET: DEFAULT_HORIZON_URL,
  MAINNET: 'https://horizon.stellar.org',
};

/** Matches the timeout the readiness probe previously used inline in AppController. */
const HEALTH_CHECK_TIMEOUT_MS = 150;

export interface HorizonHealth {
  status: 'ok' | 'down';
  error?: string;
}

/**
 * HorizonService reads STELLAR_HORIZON_URL from ConfigService instead of
 * hard-coding the testnet URL (issue #291), falling back to the
 * network-appropriate default (STELLAR_NETWORK) when unset.
 */
@Injectable()
export class HorizonService {
  private readonly logger = new Logger(HorizonService.name);
  readonly horizonUrl: string;
  private readonly pollIntervalMs = 100;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get('STELLAR_HORIZON_URL');
    const network = this.config.get('STELLAR_NETWORK');
    this.horizonUrl =
      configured || HORIZON_URLS[network] || DEFAULT_HORIZON_URL;
  }

  /**
   * Returns the effective Horizon base URL (no trailing slash) this service
   * talks to.
   *
   * Resolved once in the constructor: `STELLAR_HORIZON_URL` if set, otherwise
   * the default for `STELLAR_NETWORK` (testnet/mainnet), otherwise the
   * testnet URL. Stable for the process lifetime — callers building their
   * own Horizon requests should use this rather than re-deriving the URL, so
   * a URL override is honoured everywhere. Also exposed as the public
   * `horizonUrl` field; this getter exists for call sites that prefer a
   * method.
   */
  getHorizonUrl(): string {
    return this.horizonUrl;
  }

  /**
   * Readiness-probe style health check: a bounded-time GET against the
   * Horizon root. Folded in from AppController's ad-hoc checkHorizon
   * (issue #562) so the check is unit-testable in isolation.
   */
  async checkHealth(): Promise<HorizonHealth> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HEALTH_CHECK_TIMEOUT_MS,
    );

    try {
      const response = await fetch(this.horizonUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      if (response.ok) {
        return { status: 'ok' };
      }
      const error = `Horizon returned status ${response.status}`;
      this.logger.error(`Horizon health check failed: ${error}`);
      return { status: 'down', error };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Horizon connection failed';
      this.logger.error(`Horizon health check failed: ${message}`);
      return { status: 'down', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Polls Horizon for `transactionHash` until it reports at least
   * `targetConfirmations` (default 3) or `timeoutMs` (default 10s) elapses.
   *
   * Resolves only on success. **Throws `Error('Horizon confirmation timed
   * out')` on timeout** — including the case where the transaction never
   * appears (a 404 is swallowed and retried, not distinguished from "not yet
   * confirmed"). Polls every ~100ms; transient request errors are ignored
   * until the deadline. Safe to call again with the same hash after a
   * timeout — it is a read-only poll and holds no state.
   */
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
