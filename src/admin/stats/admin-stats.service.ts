import { Injectable } from '@nestjs/common';
import { EscrowRecord, PrismaService } from '../../prisma/prisma.service';
import { AdminStatsDto } from './dto/admin-stats.dto';

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aggregates escrow, volume, participant, and dispute totals for admins. */
  async getStats(): Promise<AdminStatsDto> {
    const [allEscrows, allDisputes] = await Promise.all([
      this.prisma.escrow.findMany({}),
      this.prisma.dispute.findMany({}),
    ]);

    const totalEscrows = allEscrows.length;
    const escrows = allEscrows as EscrowRecord[];
    const totalVolume = escrows.reduce<number>(
      (sum, e) => sum + Number(e.amount),
      0,
    );

    const escrowsByState: Record<string, number> = {};
    for (const e of escrows) {
      escrowsByState[e.state] = (escrowsByState[e.state] ?? 0) + 1;
    }

    const uniqueVendors = new Set(escrows.map((e) => e.vendorAddress)).size;
    const uniqueBuyers = new Set(escrows.map((e) => e.buyerAddress)).size;

    const totalDisputes = allDisputes.length;
    const openDisputes = allDisputes.filter(
      (d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW',
    ).length;

    const averageEscrowAmount =
      totalEscrows > 0 ? totalVolume / totalEscrows : 0;

    return {
      totalEscrows,
      totalVolume,
      escrowsByState,
      uniqueVendors,
      uniqueBuyers,
      totalDisputes,
      openDisputes,
      averageEscrowAmount,
    };
  }
}
