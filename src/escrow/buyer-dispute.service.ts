import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { DisputeRecord } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { S3PresignService } from '../common/services/s3-presign.service';
import { DisputeRepository } from '../dispute/dispute.repository';
import { EscrowRepository } from './escrow.repository';
import { OpenDisputeDto } from './dto/open-dispute.dto';

export interface DisputeResponseDto {
  id: string;
  escrowId: string;
  reason: string;
  description: string;
  evidenceUrls: string[];
  status: string;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BuyerDisputeService {
  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly disputeRepository: DisputeRepository,
    private readonly notificationsService: NotificationsService,
    private readonly s3PresignService: S3PresignService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Opens a dispute against an escrow on behalf of one of its participants.
   *
   * The caller must be the buyer, the vendor, or the configured admin address;
   * anyone else is rejected. A second dispute cannot be opened while the escrow
   * is already `DISPUTED`.
   *
   * On success the dispute row is created first, then the linked escrow is
   * transitioned to `DISPUTED` (which evicts the escrow cache so a subsequent
   * `findById` sees the new state), and finally the buyer/vendor and admin
   * notifications are dispatched together. Those notifications are awaited, so
   * a notification failure rejects the call even though the dispute and the
   * state change have already been persisted.
   *
   * @throws NotFoundException if the escrow does not exist.
   * @throws ForbiddenException if the caller is not a participant or the admin.
   * @throws ConflictException if a dispute is already open for the escrow.
   */
  async openDispute(
    escrowId: string,
    callerAddress: string,
    dto: OpenDisputeDto,
  ): Promise<DisputeResponseDto> {
    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) {
      throw new NotFoundException(`Escrow ${escrowId} not found`);
    }

    const adminAddress = this.configService.get('ADMIN_ADDRESS');
    const isAdmin = callerAddress === adminAddress;
    const isBuyer = callerAddress === escrow.buyerAddress;
    const isVendor = callerAddress === escrow.vendorAddress;

    if (!isAdmin && !isBuyer && !isVendor) {
      throw new ForbiddenException('You are not involved in this escrow');
    }

    if (escrow.state === 'DISPUTED') {
      throw new ConflictException('A dispute is already open for this escrow');
    }

    const dispute = await this.disputeRepository.create({
      escrowId,
      reason: dto.reason,
      description: dto.description,
      evidenceUrls: dto.evidenceUrls ?? [],
    });
    // Transition the linked escrow to DISPUTED and evict the cache so
    // a subsequent findById sees the fresh state.
    await this.escrowRepository.updateState(escrowId, 'DISPUTED');

    await Promise.all([
      this.notificationsService.notifyDisputed(escrow),
      this.notificationsService.notifyDisputedAdmin(escrow, adminAddress),
    ]);

    return this.toResponse(dispute);
  }

  /**
   * Returns the dispute attached to an escrow after authorising the caller.
   *
   * Access is limited to the escrow's buyer, vendor, or the configured admin
   * address, and participation is checked before the dispute lookup so a
   * stranger cannot probe whether a dispute exists. Evidence URLs on the
   * returned DTO are re-signed for direct client access.
   *
   * @throws NotFoundException if the escrow does not exist, or if it exists but
   *   has no dispute recorded.
   * @throws ForbiddenException if the caller is not a participant or the admin.
   */
  async getDispute(
    escrowId: string,
    callerAddress: string,
  ): Promise<DisputeResponseDto> {
    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) {
      throw new NotFoundException(`Escrow ${escrowId} not found`);
    }

    const adminAddress = this.configService.get('ADMIN_ADDRESS');
    const isAdmin = callerAddress === adminAddress;
    const isBuyer = callerAddress === escrow.buyerAddress;
    const isVendor = callerAddress === escrow.vendorAddress;

    if (!isAdmin && !isBuyer && !isVendor) {
      throw new ForbiddenException('You are not involved in this escrow');
    }

    const dispute = await this.disputeRepository.findByEscrow(escrowId);
    if (!dispute) {
      throw new NotFoundException(`No dispute found for escrow ${escrowId}`);
    }

    return this.toResponse(dispute);
  }

  private toResponse(dispute: DisputeRecord): DisputeResponseDto {
    return {
      id: dispute.id,
      escrowId: dispute.escrowId,
      reason: dispute.reason,
      description: dispute.description ?? '',
      evidenceUrls: this.s3PresignService.presignAll(
        dispute.evidenceUrls ?? [],
      ),
      status: dispute.status,
      resolvedAt: dispute.resolvedAt,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
    };
  }
}
