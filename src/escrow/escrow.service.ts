import crypto from 'node:crypto';
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
import { ContractService } from '../stellar/contract.service';
import { EscrowResponseDto } from './dto/escrow-response.dto';
import { EscrowSummaryDto } from './dto/escrow-summary.dto';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { EvidenceUploadResponseDto } from './dto/evidence-upload.dto';
import { S3PresignService } from '../common/services/s3-presign.service';
import { EscrowRepository } from './escrow.repository';
import { UpdateBuyerContactDto } from './dto/update-buyer-contact.dto';
import { encryptContact } from '../common/sanitization/contact-encryption.util';

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

export type SyncResult =
  | { skipped: boolean; reason?: string }
  | { skipped: false };

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly notificationsService: NotificationsService,
    private readonly s3PresignService: S3PresignService,
    private readonly contractService: ContractService,
    @Optional()
    private readonly logisticsService?: LogisticsService,
    @Optional()
    private readonly cacheService?: CacheService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  /** Returns cached or live shipment tracking status for an escrow. */
  async getTracking(id: string): Promise<{
    status: string;
    estimatedDelivery?: Date;
    carrier?: string;
    events: Array<{
      timestamp: Date;
      status: string;
      location?: string;
      description: string;
    }>;
  }> {
    const escrow = await this.findById(id);

    if (!escrow.trackingId) {
      throw new NotFoundException('Tracking information not available');
    }

    const key = `tracking:${escrow.trackingId}`;
    if (!this.logisticsService) {
      throw new NotFoundException('Tracking service not available');
    }

    const cached = await this.cacheService?.get<{
      status: string;
      estimatedDelivery?: Date;
      carrier?: string;
      events: Array<{
        timestamp: Date;
        status: string;
        location?: string;
        description: string;
      }>;
    }>(key);
    if (cached) {
      return cached;
    }

    try {
      const status = await this.logisticsService.getStatus(escrow.trackingId);

      const details = {
        status: status.status,
        estimatedDelivery: undefined,
        carrier: undefined,
        events: [],
      };

      await this.cacheService?.set(key, details, 60);
      return details;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to fetch tracking details';
      throw new NotFoundException(
        `Unable to fetch tracking details: ${message}`,
      );
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
      const message =
        error instanceof Error ? error.message : 'Failed to retrieve escrow';
      this.logger.error(`Error finding escrow ${id}: ${message}`, error);
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

  /**
   * Returns the public escrow projection plus an optional viewer field when a
   * caller address is provided.  The viewer field is computed purely from the
   * existing record — no additional DB query is needed.
   */
  async getEscrowForViewer(
    id: string,
    callerAddress?: string,
  ): Promise<EscrowResponseDto & { viewer?: { isBuyer: boolean; isVendor: boolean } }> {
    const escrow = await this.findById(id);
    const base = this.toPublicEscrow(escrow);
    if (!callerAddress) return base;
    return {
      ...base,
      viewer: {
        isBuyer: escrow.buyerAddress === callerAddress,
        isVendor: escrow.vendorAddress === callerAddress,
      },
    };
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
    // Explicit allowlist — buyerContactEmail and buyerContactPhone are
    // deliberately excluded so encrypted contact data never reaches the client.
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

  /** Generates a pre-signed upload URL for evidence files scoped to the caller. */
  generateEvidenceUploadUrl(
    callerAddress: string,
    fileName: string,
  ): EvidenceUploadResponseDto {
    const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
    const uuid = crypto.randomUUID();
    const storagePath = `evidence/${callerAddress}/`;
    const objectKey = `${storagePath}${uuid}.${ext}`;
    const publicUrl = `https://storage.trustlink.io/${objectKey}`;
    const presigned = this.s3PresignService.presign(publicUrl);
    const expiresInSeconds = 3600;

    return {
      uploadUrl: presigned,
      publicUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      expiresInSeconds,
      fileName,
      storagePath,
    };
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

  /** Cancels a pending (CREATED) escrow with on-chain state verification and fund refund. */
  async cancelPendingEscrow(
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

    if (escrow.state !== 'CREATED') {
      throw new ConflictException(
        `Cannot cancel escrow in ${escrow.state} state. Only CREATED (pending) escrows can be cancelled.`,
      );
    }

    const chainState = await this.contractService.getEscrowState(escrowId);

    if (chainState.exists && chainState.state === 'FUNDED') {
      this.logger.log(
        `Escrow ${escrowId} funded on-chain — submitting on-chain refund before cancellation`,
      );
      const txHash = await this.contractService.cancelEscrowOnChain(escrowId);
      this.logger.log(
        `On-chain refund submitted for escrow ${escrowId}: ${txHash}`,
      );
    } else if (chainState.exists && chainState.state !== 'CREATED') {
      throw new ConflictException(
        `On-chain escrow is in ${chainState.state} state and cannot be cancelled.`,
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

      if (escrow.vendorAddress !== vendorAddress) {
        this.logger.warn(
          `Unauthorized shipment attempt for escrow ${escrowId} by ${vendorAddress}`,
        );
        throw new ForbiddenException(
          'Only the escrow vendor can ship this order',
        );
      }

      if (escrow.state !== 'FUNDED') {
        throw new ConflictException(
          `Cannot ship escrow in ${escrow.state} state. Escrow must be in FUNDED state.`,
        );
      }

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

      await this.cacheService?.del(`tracking:${trackingId.trim()}`);

      this.notificationsService.notifyShipped(shipped).catch((error) => {
        this.logger.error(
          `Failed to send shipped notification for escrow ${shipped.id}`,
          error,
        );
      });

      this.logger.log(`Escrow ${escrowId} shipped successfully`);
      return shipped;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to ship escrow';
      this.logger.error(`Failed to ship escrow ${escrowId}: ${message}`, error);
      throw error;
    }
  }

  // ── Issue #28 ─────────────────────────────────────────────────────────────

  /**
   * Stores encrypted buyer contact info (email and/or phone) on the escrow.
   *
   * The escrow must exist and must not be in a terminal state — there is no
   * point collecting contact info for a completed or cancelled escrow.
   *
   * Each value is encrypted individually with AES-256-GCM before being
   * handed to the repository. The repository never sees plaintext.
   *
   * Returns a minimal acknowledgement — the encrypted values are never
   * included in any response shape.
   */
  async updateBuyerContact(
    escrowId: string,
    dto: UpdateBuyerContactDto,
  ): Promise<{ message: string }> {
    const escrow = await this.findById(escrowId);

    if (TERMINAL_STATES.has(escrow.state)) {
      throw new ConflictException(
        `Cannot update buyer contact for an escrow in ${escrow.state} state.`,
      );
    }

    const encryptedEmail = dto.email ? encryptContact(dto.email) : null;
    const encryptedPhone = dto.phone ? encryptContact(dto.phone) : null;

    await this.escrowRepository.saveBuyerContact(
      escrowId,
      encryptedEmail,
      encryptedPhone,
    );

    this.logger.log(
      JSON.stringify({
        msg: 'escrow.buyer_contact.updated',
        escrowId,
        hasEmail: Boolean(dto.email),
        hasPhone: Boolean(dto.phone),
      }),
    );

    return { message: 'Buyer contact information saved.' };
  }

  // ── Issue #40: on-chain event handler ─────────────────────────────────────

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
        const funded = await this.escrowRepository.updateState(
          escrowId,
          'FUNDED',
        );
        this.notificationsService
          .notifyFunded(funded)
          .catch((err) => this.logger.error('notifyFunded failed', err));
        return { skipped: false };
      }

      case 'EscrowShipped': {
        if (escrow.state === 'SHIPPED' || TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'already_shipped_or_terminal' };
        }
        const trackingId = event.trackingId ?? escrow.trackingId ?? '';
        const shipped = await this.escrowRepository.markShipped(
          escrowId,
          trackingId,
        );
        this.notificationsService
          .notifyShipped(shipped)
          .catch((err) => this.logger.error('notifyShipped failed', err));
        return { skipped: false };
      }

      case 'EscrowCompleted': {
        if (escrow.state === 'COMPLETED' || TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'already_completed_or_terminal' };
        }
        const completed = await this.escrowRepository.markCompleted(escrowId);
        this.notificationsService
          .notifyCompleted(completed)
          .catch((err) => this.logger.error('notifyCompleted failed', err));
        return { skipped: false };
      }

      case 'DisputeRaised': {
        if (escrow.state === 'DISPUTED') {
          return { skipped: true, reason: 'already_disputed' };
        }
        if (TERMINAL_STATES.has(escrow.state)) {
          return { skipped: true, reason: 'terminal_state' };
        }
        if (this.prisma) {
          await this.prisma.dispute.create({
            data: {
              id: crypto.randomUUID(),
              escrowId,
              reason: event.reason ?? 'on-chain dispute',
              description: '',
              evidenceUrls: [],
            },
          });
        }
        const disputed = await this.escrowRepository.updateState(
          escrowId,
          'DISPUTED',
        );
        this.notificationsService
          .notifyDisputed(disputed)
          .catch((err) => this.logger.error('notifyDisputed failed', err));
        return { skipped: false };
      }

      case 'DisputeResolved': {
        if (this.prisma) {
          const disputeList = await this.prisma.dispute.findMany({
            where: { escrowId },
          });
          const firstDispute = disputeList[0];
          if (firstDispute?.status === 'RESOLVED') {
            return { skipped: true, reason: 'dispute_already_resolved' };
          }
          if (firstDispute) {
            await this.prisma.dispute.update({
              where: { id: firstDispute.id },
              data: { status: 'RESOLVED', resolvedAt: new Date() },
            });
          }
        }
        const resolved = await this.escrowRepository.markCompleted(escrowId);
        this.notificationsService
          .notifyCompleted(resolved)
          .catch((err) =>
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
        const released = await this.escrowRepository.markAutoReleased(
          escrowId,
          txHash,
        );
        this.notificationsService
          .notifyCompleted(released)
          .catch((err) =>
            this.logger.error('notifyCompleted(auto-released) failed', err),
          );
        return { skipped: false };
      }

      default: {
        this.logger.warn(
          JSON.stringify({
            msg: 'escrow.sync.unknown_event',
            eventType,
            escrowId,
          }),
        );
        return { skipped: true, reason: 'unknown_event_type' };
      }
    }
  }
}
