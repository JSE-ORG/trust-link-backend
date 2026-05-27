import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowRecord } from '../prisma/prisma.service';
import { EscrowResponseDto } from './dto/escrow-response.dto';
import { EscrowSummaryDto } from './dto/escrow-summary.dto';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { EscrowRepository } from './escrow.repository';

export type EscrowWithPaymentUrl = EscrowRecord & {
  paymentUrl: string;
};

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

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

  async getPublicEscrow(id: string): Promise<EscrowResponseDto> {
    const escrow = await this.findById(id);
    return this.toPublicEscrow(escrow);
  }

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
      itemRef: escrow.itemRef,
      amount: escrow.amount,
      currency: escrow.currency,
      state: escrow.state,
      trackingId: escrow.trackingId,
      shippedAt: escrow.shippedAt,
      createdAt: escrow.createdAt,
      updatedAt: escrow.updatedAt,
    };
  }

  private toSummary(escrow: EscrowRecord) {
    return {
      id: escrow.id,
      itemName: escrow.itemName,
      itemRef: escrow.itemRef,
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

  async handleShipment(
    escrowId: string,
    vendorAddress: string,
    trackingId: string,
  ): Promise<EscrowRecord> {
    try {
      // Enhanced validation
      if (!trackingId?.trim()) {
        throw new BadRequestException('Tracking ID is required and cannot be empty');
      }

      if (trackingId.trim().length < 3) {
        throw new BadRequestException('Tracking ID must be at least 3 characters long');
      }

      const escrow = await this.findById(escrowId);
      
      // Authorization check
      if (escrow.vendorAddress !== vendorAddress) {
        this.logger.warn(`Unauthorized shipment attempt for escrow ${escrowId} by ${vendorAddress}`);
        throw new ForbiddenException('Only the escrow vendor can ship this order');
      }

      // State validation
      if (escrow.state !== 'FUNDED') {
        throw new ConflictException(`Cannot ship escrow in ${escrow.state} state. Escrow must be in FUNDED state.`);
      }

      // Check if already shipped
      if (escrow.trackingId) {
        throw new ConflictException(`Escrow already shipped with tracking ID: ${escrow.trackingId}`);
      }

      this.logger.log(`Shipping escrow ${escrowId} with tracking ID: ${trackingId}`);
      
      const shipped = await this.escrowRepository.markShipped(escrow.id, trackingId.trim());
      
      // Notify asynchronously
      this.notificationsService.notifyShipped(shipped).catch(error => {
        this.logger.error(`Failed to send shipped notification for escrow ${shipped.id}`, error);
      });
      
      this.logger.log(`Escrow ${escrowId} shipped successfully`);
      return shipped;
    } catch (error) {
      this.logger.error(`Failed to ship escrow ${escrowId}: ${error.message}`, error);
      throw error;
    }
  }
}
