import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { STELLAR_SERVER } from './stellar.tokens';

/**
 * Health status of the Soroban RPC endpoint.
 *
 * Mirrors `HorizonHealth` in `horizon.service.ts` so the readiness probe can
 * treat both Stellar dependencies the same way.
 */
export interface SorobanHealth {
  status: 'ok' | 'down';
  error?: string;
}

/**
 * Minimal shape of the RPC health response.
 *
 * `rpc.Server.getHealth()` resolves with the JSON-RPC `getHealth` result. The
 * SDK's `getHealth` *rejects* on a transport error and resolves with a `status`
 * field otherwise, so both paths have to be inspected: a resolved response
 * carrying a non-passing status is still an unhealthy node.
 */
interface RpcHealthResponse {
  status?: string;
  latestLedger?: number;
  oldestLedger?: number;
}

interface HealthCapableServer {
  getHealth(): Promise<RpcHealthResponse>;
}

/**
 * Statuses `getHealth` can report on a node that answered the request.
 *
 * `pass` is the only healthy value. A node can answer `getHealth` while being
 * unable to serve contract traffic — `degraded` means it is behind, and
 * `fail` means it is not usable — so both are treated as down rather than
 * being folded into "the call resolved, so it must be fine".
 */
const HEALTHY_STATUSES = new Set(['pass']);

/**
 * Milliseconds the readiness probe waits for the RPC health response.
 *
 * Matches `HEALTH_CHECK_TIMEOUT_MS` in `horizon.service.ts` (150 ms) so the
 * two Stellar checks are bounded identically. The probe is polled by load
 * balancers on a short interval, so a slow RPC must not hold the request open
 * — and `getHealth()` takes no abort signal, so the bound is applied by
 * racing the promise rather than by cancelling the request.
 */
export const SOROBAN_HEALTH_TIMEOUT_MS = 150;

@Injectable()
export class SorobanHealthService {
  private readonly logger = new Logger(SorobanHealthService.name);

  constructor(
    @Optional()
    @Inject(STELLAR_SERVER)
    private readonly server?: HealthCapableServer,
  ) {}

  /**
   * Liveness check for the Soroban RPC server.
   *
   * #841 — Every contract call is submitted through the `rpc.Server` built
   * from `SOROBAN_RPC_URL` in `stellar.module.ts`, and the readiness probe did
   * not check it. Health therefore reported `ok` while escrow funding, release
   * and delivery all failed to submit, which is the worst possible signal for
   * a probe: traffic kept being routed to an instance that could not act on
   * it.
   *
   * Never throws. `checkAllDependencies` awaits the checks with
   * `Promise.all`, so a rejection here would fail the whole probe with a 500
   * and take a healthy instance out of the load balancer.
   */
  async checkHealth(): Promise<SorobanHealth> {
    if (!this.server || typeof this.server.getHealth !== 'function') {
      // No server bound: nothing to probe, and the probe must not fail because
      // a module chose not to provide one.
      return { status: 'ok' };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // `getHealth()` rejects on a transport error rather than resolving with
      // a failing status, and it accepts no abort signal, so the timeout is a
      // race: the underlying request is abandoned, not cancelled, but the
      // probe stops waiting on it.
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(
          () => resolve('timeout'),
          SOROBAN_HEALTH_TIMEOUT_MS,
        );
      });

      const response = await Promise.race([
        this.server.getHealth(),
        timeout,
      ]);

      if (response === 'timeout') {
        const error = `Soroban RPC did not respond within ${SOROBAN_HEALTH_TIMEOUT_MS}ms`;
        this.logger.error(`Soroban RPC health check failed: ${error}`);
        return { status: 'down', error };
      }

      const status = response?.status;
      if (typeof status === 'string' && HEALTHY_STATUSES.has(status)) {
        return { status: 'ok' };
      }

      const error =
        typeof status === 'string' && status.length > 0
          ? `Soroban RPC reported status ${status}`
          : 'Soroban RPC returned no health status';
      this.logger.error(`Soroban RPC health check failed: ${error}`);
      return { status: 'down', error };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Soroban RPC connection failed';
      this.logger.error(`Soroban RPC health check failed: ${message}`);
      return { status: 'down', error: message };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
