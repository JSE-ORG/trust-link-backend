import { Injectable } from '@nestjs/common';
import {
  DisputeRecord,
  DisputeState,
  EscrowState,
  PrismaService,
  toDisputeRecord,
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
    return this.prisma.dispute.create({ data }).then(toDisputeRecord);
  }

  /** Returns a dispute by its primary key, or null if not found. */
  findById(id: string): Promise<DisputeRecord | null> {
    return this.prisma.dispute
      .findUnique({ where: { id } })
      .then((row) => (row ? toDisputeRecord(row) : null));
  }

  /** Returns the first dispute linked to the given escrow, or null if none exists. */
  findByEscrow(escrowId: string): Promise<DisputeRecord | null> {
    return this.prisma.dispute
      .findFirst({ where: { escrowId } })
      .then((row) => (row ? toDisputeRecord(row) : null));
  }

  /**
   * Returns all disputes in OPEN or UNDER_REVIEW status.
   *
   * Kept rather than deleted (it has no production caller today, only a
   * repository test) because an admin "open disputes" view is a natural near
   * addition and the fix is a one-liner. The status filter is now a `where`
   * clause so Postgres can use `@@index([status])` instead of loading every
   * dispute row and filtering in memory (#670).
   */
  findAllOpen(): Promise<DisputeRecord[]> {
    return this.prisma.dispute
      .findMany({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
      .then((disputes) => disputes.map(toDisputeRecord));
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

    return toDisputeRecord(resolvedDispute);
  }
}
