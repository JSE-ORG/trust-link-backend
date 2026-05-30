import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowRecord } from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { LogisticsService } from '../logistics/logistics.service';
import { CacheService } from '../common/cache.service';
import { EscrowResponseDto } from './dto/escrow-response.dto';
import { EscrowSummaryDto } from './dto/escrow-summary.dto';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { EscrowRepository } from './escrow.repository';

export type EscrowWithPaymentUrl = EscrowRecord & {
  paymentUrl: string;
};

/** Parsed Soroban event forwarded from the blockchain listener. */
export interface SorobanChainEvent {
  /** Soroban event name: EscrowFunded | EscrowShipped | EscrowCompleted |
   *  DisputeRaised | DisputeResolved | AutoReleased */
  eventType: string;
  /** Trust-Link escrow ID stored in the contract. */
  escrowId: string;
  /** For EscrowShipped — on-chain tracking reference. */
  trackingId?: string;
  /** For AutoReleased — on-chain transaction hash. */
  txHash?: string;
  /** For DisputeRaised — reason/description surfaced from contract data. */
  reason?: string;
}

/** States that represent a terminal escrow lifecycle — no further transitions. */
const TERMINAL_STATES = new Set<string>([
  'COMPLETED',
  'RELEASED',
  'REFUNDED',
  'CANCELLED',
]);

export type SyncResult = { skipped: boolean; reason?: string } | { skipped: false };

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly notificationsService: NotificationsService,
    @Optional()
    private readonly logisticsService?: LogisticsService,
    @Optional()
    private readonly cacheService?: CacheService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  /** Returns cached or live shipment tracking status for an escrow. */
  async getTracking(
    id: string,
  ): Promise<{ status: string } & { cached?: boolean }> {
    const escrow = await this.findById(id);

    if (!escrow.trackingId) {
      throw new NotFoundException('Tracking information not available');
    }

    const key = `tracking:${escrow.trackingId}`;
    if (!this.logisticsService) {
      throw new NotFoundException('Tracking service not available');
    }

    const cached = await this.cacheService?.get<{ status: string }>(key);
    if (cached) {
      return { ...cached, cached: true };
    }

    try {
      const status = await this.logisticsService.getStatus(escrow.trackingId);
      await this.cacheService?.set(key, status, 60);
      return { ...status, cached: false };
    } catch (err) {
      throw err;
    }
  }

  /** Creates a funded escrow after validating amount and duplicate item reference. */
  async createEscrow(
    dto: CreateEscrowDto,
    vendorAddress: string,
  ): Promise<EscrowWithPaymentUrl> {
    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const existing = await this.escrowRepository.findByVendorAndItem(
      vendorAddress,
      dto.itemRef,
    );
    if (existing) {
      throw new ConflictException('Duplicate escrow for this item reference');
    }

    const escrow = await this.escrowRepository.create(dto, vendorAddress);
    await this.notificationsService.notifyFunded(escrow);
    return {
      ...escrow,
      paymentUrl: this.buildPaymentUrl(escrow.id),
    };
  }

  /** Loads an escrow by ID or raises a typed not-found error. */
  async findById(id: string): Promise<EscrowRecord> {
    try {
      const escrow = await this.escrowRepository.findById(id);
      if (!escrow) {
        this.logger.warn(`Escrow not found with ID: ${id}`);
        throw new NotFoundException(`Escrow with ID ${id} not found`);
      }
      return escrow;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error finding escrow ${id}: ${error.message}`, error);
      throw new BadRequestException('Failed to retrieve escrow');
    }
  }

  /** Returns chronological event history for an escrow; empty array if not found. */
  async getEvents(
    id: string,
  ): Promise<Array<{ event: string; occurredAt: Date }>> {
    return this.escrowRepository.findEvents(id);
  }

  /** Returns the public escrow projection safe for client responses. */
  async getPublicEscrow(id: string): Promise<EscrowResponseDto> {
    const escrow = await this.findById(id);
    return this.toPublicEscrow(escrow);
  }

  /** Returns a paginated vendor escrow summary list using query defaults. */
  async findVendorEscrows(
    vendorAddress: string,
    query: {
      state?: string;
      sort?: 'date' | 'amount';
      order?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    },
  ): Promise<{
    data: EscrowSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const sort = query.sort ?? 'date';
    const order = query.order ?? 'desc';
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { data, total } = await this.escrowRepository.findVendorEscrows(
      vendorAddress,
      query.state,
      sort,
      order,
      page,
      limit,
    );

    return {
      data: data.map((escrow) => this.toSummary(escrow)),
      total,
      page,
      limit,
    };
  }

  private toPublicEscrow(escrow: EscrowRecord) {
    return {
      id: escrow.id,
      itemName: escrow.itemName,
      itemRef: escrow.itemRef ?? '',
      amount: escrow.amount,
      currency: escrow.currency,
      state: escrow.state,
      trackingId: escrow.trackingId,
      shippedAt: escrow.shippedAt ?? null,
      createdAt: escrow.createdAt,
      updatedAt: escrow.updatedAt,
    };
  }

  private toSummary(escrow: EscrowRecord) {
    return {
      id: escrow.id,
      itemName: escrow.itemName,
      itemRef: escrow.itemRef ?? '',
      amount: escrow.amount,
      currency: escrow.currency,
      state: escrow.state,
      trackingId: escrow.trackingId,
      createdAt: escrow.createdAt,
      updatedAt: escrow.updatedAt,
    };
  }

  private buildPaymentUrl(id: string): string {
    return `https://trust-link.local/pay/${id}`;
  }

  /** Cancels a funded escrow when requested by the buyer or vendor. */
  async cancelEscrow(
    escrowId: string,
    callerAddress: string,
  ): Promise<EscrowRecord> {
    const escrow = await this.findById(escrowId);

    if (
      escrow.vendorAddress !== callerAddress &&
      escrow.buyerAddress !== callerAddress
    ) {
      throw new ForbiddenException(
        'Only the vendor or buyer can cancel this escrow',
      );
    }

    if (escrow.state !== 'FUNDED') {
      throw new ConflictException(
        `Cannot cancel escrow in ${escrow.state} state. Only FUNDED escrows can be cancelled.`,
      );
    }

    return this.escrowRepository.markCancelled(escrowId);
  }

  /** Validates vendor shipment updates and moves a funded escrow to shipped. */
  async handleShipment(
    escrowId: string,
    vendorAddress: string,
    trackingId: string,
  ): Promise<EscrowRecord> {
    try {
      // Enhanced validation
      if (!trackingId?.trim()) {
        throw new BadRequestException(
          'Tracking ID is required and cannot be empty',
        );
      }

      if (trackingId.trim().length < 3) {
        throw new BadRequestException(
          'Tracking ID must be at least 3 characters long',
        );
      }

      const escrow = await this.findById(escrowId);

      // Authorization check
      if (escrow.vendorAddress !== vendorAddress) {
        this.logger.warn(
          `Unauthorized shipment attempt for escrow ${escrowId} by ${vendorAddress}`,
        );
        throw new ForbiddenException(
          'Only the escrow vendor can ship this order',
        );
      }

      // State validation
      if (escrow.state !== 'FUNDED') {
        throw new ConflictException(
          `Cannot ship escrow in ${escrow.state} state. Escrow must be in FUNDED state.`,
        );
      }

      // Check if already shipped
      if (escrow.trackingId) {
        throw new ConflictException(
          `Escrow already shipped with tracking ID: ${escrow.trackingId}`,
        );
      }

      this.logger.log(
        `Shipping escrow ${escrowId} with tracking ID: ${trackingId}`,
      );

      const shipped = await this.escrowRepository.markShipped(
        escrow.id,
        trackingId.trim(),
      );

      // Notify asynchronously
      this.notificationsService.notifyShipped(shipped).catch((error) => {
        this.logger.error(
          `Failed to send shipped notification for escrow ${shipped.id}`,
          error,
        );
      });

      this.logger.log(`Escrow ${escrowId} shipped successfully`);
      return shipped;
    } catch (error) {
      this.logger.error(
        `Failed to ship escrow ${escrowId}: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  // ── Issue #40: on-chain event handler ─────────────────────────────────────

  /**
   * Receives a parsed Soroban event from the blockchain listener and syncs the
   * corresponding escrow (and dispute) record in the database.
   *
   * Idempotent: calling this method twice with the same event payload is safe —
   * a record that is already in the expected post-event state is silently
   * skipped rather than updated again.
   *
   * Supported events
   * ─────────────────
   * EscrowFunded      → CREATED → FUNDED, notifyFunded
   * EscrowShipped     → FUNDED  → SHIPPED (with trackingId), notifyShipped
   * EscrowCompleted   → *       → COMPLETED, notifyCompleted
   * DisputeRaised     → *       → DISPUTED, creates Dispute row, notifyDisputed
   * DisputeResolved   → DISPUTED → COMPLETED, marks dispute RESOLVED, notifyCompleted
   * AutoReleased      → *       → RELEASED (records txHash), notifyCompleted
   */
  async syncStateFromChain(event: SorobanChainEvent): Promise<SyncResult> {
    const { eventType, escrowId } = event;

    this.logger.log(
      JSON.stringify({ msg: 'escrow.sync.received', eventType, escrowId }),
    );

    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) {
      this.logger.warn(
        JSON.stringify({ msg: 'escrow.sync.not_found', eventType, escrowId }),
      );
      return { skipped: true, reason: 'escrow_not_found' };
    }

    switch (eventType) {
      case 'EscrowFunded': {
        if (escrow.state === 'FUNDED' || TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'already_funded_or_terminal' };
        }
        const funded = await this.escrowRepository.updateState(escrowId, 'FUNDED');
        this.notificationsService.notifyFunded(funded).catch((err) =>
          this.logger.error('notifyFunded failed', err),
        );
        return { skipped: false };
      }

      case 'EscrowShipped': {
        if (escrow.state === 'SHIPPED' || TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'already_shipped_or_terminal' };
        }
        const trackingId = event.trackingId ?? escrow.trackingId ?? '';
        const shipped = await this.escrowRepository.markShipped(escrowId, trackingId);
        this.notificationsService.notifyShipped(shipped).catch((err) =>
          this.logger.error('notifyShipped failed', err),
        );
        return { skipped: false };
      }

      case 'EscrowCompleted': {
        if (escrow.state === 'COMPLETED' || TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'already_completed_or_terminal' };
        }
        const completed = await this.escrowRepository.markCompleted(escrowId);
        this.notificationsService.notifyCompleted(completed).catch((err) =>
          this.logger.error('notifyCompleted failed', err),
        );
        return { skipped: false };
      }

      case 'DisputeRaised': {
        if (escrow.state === 'DISPUTED') {
          return { skipped: true, reason: 'already_disputed' };
        }
        if (TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'terminal_state' };
        }
        // Create the dispute record then flip escrow state.
        if (this.prisma) {
          await this.prisma.dispute.create({
            data: {
              escrowId,
              reason: event.reason ?? 'on-chain dispute',
              description: '',
              evidenceUrls: [],
            },
          });
        }
        const disputed = await this.escrowRepository.updateState(escrowId, 'DISPUTED');
        this.notificationsService.notifyDisputed(disputed).catch((err) =>
          this.logger.error('notifyDisputed failed', err),
        );
        return { skipped: false };
      }

      case 'DisputeResolved': {
        // Idempotency: skip if the dispute is already resolved.
        if (this.prisma) {
          const dispute = await this.prisma.dispute.findFirst({
            where: { escrowId },
          });
          if (dispute?.status === 'RESOLVED') {
            return { skipped: true, reason: 'dispute_already_resolved' };
          }
          if (dispute) {
            await this.prisma.dispute.update({
              where: { id: dispute.id },
              data: { status: 'RESOLVED', resolvedAt: new Date() },
            });
          }
        }
        const resolved = await this.escrowRepository.markCompleted(escrowId);
        this.notificationsService.notifyCompleted(resolved).catch((err) =>
          this.logger.error('notifyCompleted(dispute resolved) failed', err),
        );
        return { skipped: false };
      }

      case 'AutoReleased': {
        if (escrow.state === 'RELEASED') {
          return { skipped: true, reason: 'already_released' };
        }
        if (TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'terminal_state' };
        }
        const txHash = event.txHash ?? '';
        const released = await this.escrowRepository.markAutoReleased(escrowId, txHash);
        this.notificationsService.notifyCompleted(released).catch((err) =>
          this.logger.error('notifyCompleted(auto-released) failed', err),
        );
        return { skipped: false };
      }

      default: {
        this.logger.warn(
          JSON.stringify({ msg: 'escrow.sync.unknown_event', eventType, escrowId }),
        );
        return { skipped: true, reason: 'unknown_event_type' };
      }
    }
  }
}
