import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { TracingService } from '../tracing/tracing.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import { LogisticsService } from '../logistics/logistics.service';
import { ContractService } from '../stellar/contract.service';
import { ConfigService } from '../config/config.service';
import { TEN_MINUTES_MS } from '../common/constants/time.constants';

@Injectable()
export class TrackingPollWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TrackingPollWorker.name);
  private timer: NodeJS.Timeout | null = null;

  /**
   * #840 — True while a run is in progress.
   *
   * This is the worker most likely to overrun its interval: the loop calls the
   * logistics API once per shipped escrow, one after another, with a 10s
   * timeout each. A provider that is slow or timing out pushes a run well past
   * the 10-minute tick, and `setInterval` starts another one on schedule
   * regardless. Overlapping runs then both walk the same shipped escrows, both
   * claim and both submit `record_delivery`, and a slow provider means more
   * than one run in flight at a time.
   *
   * `claimDelivery` keeps a single delivery from being recorded twice; this
   * flag stops the duplicated polling cycle itself. `SorobanPollerService.poll()`
   * guards the same way.
   */
  private running = false;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly logisticsService: LogisticsService,
    private readonly contractService: ContractService,
    private readonly configService: ConfigService,
    private readonly tracing: TracingService,
  ) {}

  /**
   * Runs `fn` inside a worker span.
   *
   * One span covers a whole worker run, and a child span covers each escrow
   * handled within it, so a run and its per-escrow work group together in a
   * single trace. The cycle is summarised with counts on the root span rather
   * than with a span per database row.
   */
  private traced<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    return this.tracing.withSpan(name, { attributes }, fn);
  }

  /**
   * Returns the contract admin address, or throws.
   *
   * `record_delivery` calls `caller.require_auth()` and then rejects the call
   * with NotAuthorized unless `caller` equals the contract admin, so this is
   * the only address the call can be made with. Resolved on use rather than in
   * the constructor, matching AutoReleaseWorker: throwing at construction
   * would take down application boot instead of just this path.
   */
  private requireAdminAddress(): string {
    const address = this.configService.get<string>('ADMIN_ADDRESS');
    if (!address) {
      throw new Error(
        'ADMIN_ADDRESS is not configured; refusing to record delivery on-chain.',
      );
    }
    return address;
  }

  onModuleInit(): void {
    if (this.configService.get('NODE_ENV') === 'test') {
      return;
    }

    this.timer = setInterval(() => {
      void this.run();
    }, TEN_MINUTES_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    // #840 — Skip a tick that arrives while the previous run is still going,
    // rather than starting a second overlapping cycle.
    if (this.running) {
      this.logger.warn(
        'TrackingPollWorker: previous run is still in progress — skipping this tick',
      );
      return;
    }
    this.running = true;

    try {
      await this.runCycle();
    } finally {
      // Cleared even when the cycle throws, or the worker would refuse every
      // subsequent tick and silently stop recording deliveries.
      this.running = false;
    }
  }

  private async runCycle(): Promise<void> {
    try {
      const shipments = await this.escrowRepository.findShippedWithTracking();

      for (const escrow of shipments) {
        if (!escrow.trackingId) {
          continue;
        }

        try {
          await this.traced(
            'worker.tracking_poll.escrow',
            {
              'trustlink.escrow.id': escrow.id,
              'trustlink.escrow.vendor_address': escrow.vendorAddress,
            },
            () => this.processShipment(escrow),
          );
        } catch (error) {
          this.logger.error(
            JSON.stringify({
              msg: 'tracking_poll.escrow_failed',
              escrowId: escrow.id,
              trackingId: escrow.trackingId,
              eventType: 'tracking_poll',
              error: error instanceof Error ? error.message : String(error),
            }),
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          msg: 'tracking_poll.worker_failed',
          eventType: 'tracking_poll',
          error: error instanceof Error ? error.message : String(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Refreshes one escrow's tracking status and records delivery on-chain.
   *
   * Runs as a child of the poll run's root span. Every `continue` in the
   * original loop body becomes a `return` here, which has the same effect:
   * the escrow is skipped and the next one is handled.
   */
  private async processShipment(escrow: {
    id: string;
    trackingId: string | null;
    contractEscrowId: bigint | null;
    vendorAddress: string;
  }): Promise<void> {
    {
      const status = await this.logisticsService.getStatus(escrow.trackingId!);
      if (status.status !== 'DELIVERED') {
        return;
      }

      // Claim the escrow before any network call. This follows the same
      // claim-and-release pattern as AutoReleaseWorker (#507): if the
      // contract call fails, the claim is cleared so the next poll cycle
      // retries. Without this, a failed recordDelivery leaves the escrow
      // in DELIVERED state permanently out of sync with the chain.
      // `record_delivery(env, caller: Address, escrow_id: u64)` addresses
      // the escrow by the contract's own id, not this row's UUID. Without
      // the mapping there is no call to make.
      if (escrow.contractEscrowId === null) {
        this.logger.warn(
          JSON.stringify({
            msg: 'tracking_poll.unmapped_escrow',
            escrowId: escrow.id,
            eventType: 'tracking_poll',
          }),
        );
        return;
      }

      const claimed = await this.escrowRepository.claimDelivery(escrow.id);
      if (!claimed) {
        return;
      }

      try {
        // The contract requires `caller` to be the admin and calls
        // require_auth() on it, so anything else is rejected outright.
        await this.contractService.recordDelivery(
          escrow.contractEscrowId,
          this.requireAdminAddress(),
        );
        await this.escrowRepository.markDelivered(escrow.id, new Date());
      } catch (error) {
        // Release the claim so the next poll cycle can retry.
        await this.escrowRepository.clearDeliveryClaim(escrow.id);
        throw error;
      }
    }
  }
}
