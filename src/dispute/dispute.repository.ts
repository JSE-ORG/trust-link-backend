import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DisputeRecord,
  DisputeState,
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

  findMany(params?: {
    where?: Prisma.DisputeWhereInput;
    orderBy?: Prisma.DisputeOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<DisputeRecord[]> {
    return this.prisma.dispute
      .findMany(params)
      .then((rows) => rows.map(toDisputeRecord));
  }

  count(where?: Prisma.DisputeWhereInput): Promise<number> {
    return this.prisma.dispute.count({ where });
  }

  findFirst(params: {
    where?: Prisma.DisputeWhereInput;
  }): Promise<DisputeRecord | null> {
    return this.prisma.dispute
      .findFirst(params)
      .then((row) => (row ? toDisputeRecord(row) : null));
  }

  update(params: {
    where: Prisma.DisputeWhereUniqueInput;
    data: Prisma.DisputeUpdateInput;
  }): Promise<DisputeRecord> {
    return this.prisma.dispute
      .update(params)
      .then((row) => toDisputeRecord(row));
  }
}
