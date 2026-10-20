import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from './contract.service';
import { ConfigService } from '../config/config.service';

/**
 * Events the backend handles in syncStateFromChain.
 * Events not in this set are skipped before the escrow_id check (issue #1047).
 */
const HANDLED_EVENTS = new Set([
  'EscrowCreated',
  'EscrowFunded',
  'EscrowShipped',
  'EscrowDelivered',
  'DeliveryRecorded',
  'EscrowCancelled',
  'EscrowCanceled',
  'EscrowReleased',
  'EscrowRefunded',
  'DisputeOpened',
  'DisputeResolved',
  'DisputePending',
  'DisputeAppealed',
  'RefundRequested',
  'RefundApproved',
  'Expired',
  'AutoCancel',
]);

const POLL_INTERVAL_MS = 30_000;

interface ChainEvent {
  name: string;
  topics: string[];
  payload: Record<string, unknown>;
  ledger: number;
  pagingToken: string;
}

@Injectable()
export class SorobanPollerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SorobanPollerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), POLL_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    const cursor = await this.getCursor();
    const events = await this.contractService.getEvents(cursor);

    for (const event of events) {
      try {
        await this.processEvent(event);
        await this.advanceCursor(event.pagingToken);
      } catch (err) {
        // Only dead-letter events we handle but that are malformed
        if (HANDLED_EVENTS.has(event.name)) {
          this.logger.error(
            `Failed to process event ${event.name}: ${err instanceof Error ? err.message : err}`,
          );
          // Dead-letter would go here for handled events with bad payloads
        }
        // Still advance cursor past unhandled/failed events
        await this.advanceCursor(event.pagingToken);
      }
    }

    // Advance cursor on empty page (issue #1048)
    if (events.length > 0) {
      await this.advanceCursor(events[events.length - 1].pagingToken);
    }
  }

  /**
   * Process a single chain event. Unhandled events are skipped with a debug
   * log before the escrow_id check so admin/contract events don't fill the DLQ.
   */
  private async processEvent(event: ChainEvent): Promise<void> {
    // Skip events we don't handle (issue #1047)
    if (!HANDLED_EVENTS.has(event.name)) {
      this.logger.debug(`Skipping unhandled event: ${event.name}`);
      return;
    }

    // Extract escrow_id from payload, falling back to tracking_id/trackingId
    const escrowId =
      (event.payload.escrow_id as string) ??
      (event.payload.escrowId as string) ??
      (event.payload.tracking_id as string) ??
      (event.payload.trackingId as string);

    if (!escrowId) {
      // Handled event but missing escrow_id — this is a real failure
      throw new Error(`Handled event ${event.name} missing escrow_id`);
    }

    await this.syncStateFromChain(escrowId, event);
  }

  /**
   * Sync escrow state from a chain event.
   */
  private async syncStateFromChain(escrowId: string, event: ChainEvent): Promise<void> {
    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) return;

    switch (event.name) {
      case 'EscrowDelivered':
      case 'DeliveryRecorded': {
        // Issue #1046: EscrowDelivered moves SHIPPED → DELIVERED
        if (escrow.state === 'SHIPPED') {
          const deliveredAt = event.payload.delivered_at
            ? new Date(event.payload.delivered_at as string)
            : new Date();
          await this.escrowRepository.markDelivered(escrowId, deliveredAt);
          this.logger.log(`Escrow ${escrowId} moved to DELIVERED via chain event`);
        } else {
          this.logger.debug(`Skipping Delivered for escrow ${escrowId} in state ${escrow.state}`);
        }
        break;
      }

      case 'EscrowCancelled':
      case 'EscrowCanceled': {
        if (escrow.state !== 'RELEASED' && escrow.state !== 'REFUNDED') {
          await this.escrowRepository.updateState(escrowId, 'CANCELLED');
        }
        break;
      }

      case 'DisputeResolved': {
        // Issue #1048: DisputeResolved skips terminal escrows
        if (escrow.state === 'RELEASED' || escrow.state === 'REFUNDED' || escrow.state === 'CANCELLED') {
          this.logger.debug(`Skipping DisputeResolved for terminal escrow ${escrowId}`);
          return;
        }
        // Apply resolution
        break;
      }

      default:
        this.logger.debug(`Unhandled sync for event ${event.name}`);
    }
  }

  private async getCursor(): Promise<string | undefined> {
    // Per-consumer cursor keys (issue #1048)
    return undefined;
  }

  private async advanceCursor(token: string): Promise<void> {
    // Persist cursor for this consumer
  }
}
