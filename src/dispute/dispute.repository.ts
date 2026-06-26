import { Injectable } from '@nestjs/common';
import {
  DisputeRecord,
  DisputeState,
  EscrowState,
  PrismaService,
} from '../prisma/prisma.service';

@Injectable()
export class DisputeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a new dispute record linked to the given escrow. */
  create(data: {
    escrowId: string;
    reason: string;
    description?: string;
    evidenceUrls?: string[];
    status?: DisputeState;
  }): Promise<DisputeRecord> {
    return this.prisma.dispute.create({ data });
  }

  /** Returns a dispute by its primary key, or null if not found. */
  findById(id: string): Promise<DisputeRecord | null> {
    return this.prisma.dispute.findUnique({ where: { id } });
  }

  /** Returns the first dispute linked to the given escrow, or null if none exists. */
  async findByEscrow(escrowId: string): Promise<DisputeRecord | null> {
    const disputes = await this.prisma.dispute.findMany({
      where: { escrowId },
    });
    return disputes[0] ?? null;
  }

  /** Returns all disputes in OPEN or UNDER_REVIEW status. */
  findAllOpen(): Promise<DisputeRecord[]> {
    return this.prisma.dispute
      .findMany()
      .then((disputes) =>
        disputes.filter(
          (dispute) =>
            dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW',
        ),
      );
  }

  /**
   * Marks the dispute as RESOLVED, records the resolution timestamp,
   * and transitions the linked escrow to the specified final state.
   */
  async resolve(
    disputeId: string,
    escrowState: EscrowState = 'COMPLETED',
  ): Promise<DisputeRecord> {
    const dispute = await this.findById(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }

    const resolvedAt = new Date();
    const resolvedDispute = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'RESOLVED', resolvedAt },
    });

    await this.prisma.escrow.update({
      where: { id: dispute.escrowId },
      data: { state: escrowState, disputeId: null },
    });

    return resolvedDispute;
  }
}
