import { Injectable } from '@nestjs/common';
import {
  EscrowRecord,
  EscrowState,
  PrismaService,
} from '../prisma/prisma.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';

@Injectable()
export class EscrowRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateEscrowDto, vendorAddress: string): Promise<EscrowRecord> {
    import { Injectable } from '@nestjs/common';
    import {
      EscrowRecord,
      EscrowState,
      PrismaService,
    } from '../prisma/prisma.service';
    import { CreateEscrowDto } from './dto/create-escrow.dto';

    @Injectable()
    export class EscrowRepository {
      constructor(private readonly prisma: PrismaService) {}

      create(dto: CreateEscrowDto, vendorAddress: string): Promise<EscrowRecord> {
        return this.prisma.escrow.create({
          data: {
            ...dto,
            vendorAddress,
          },
        });
      }

      findByVendorAndItem(
        vendorAddress: string,
        itemRef: string,
      ): Promise<EscrowRecord | null> {
        return this.prisma.escrow
          .findMany({
            where: { vendorAddress, itemRef },
          })
          .then((results) => results[0] ?? null);
      }

      findById(id: string): Promise<EscrowRecord | null> {
        return this.prisma.escrow.findUnique({ where: { id } });
      }

      findByVendor(vendorAddress: string): Promise<EscrowRecord[]> {
        return this.prisma.escrow.findMany({ where: { vendorAddress } });
      }

      findByBuyer(buyerAddress: string): Promise<EscrowRecord[]> {
        return this.prisma.escrow.findMany({ where: { buyerAddress } });
      }

      updateState(id: string, state: EscrowState): Promise<EscrowRecord> {
        return this.prisma.escrow.update({ where: { id }, data: { state } });
      }

      updateTracking(id: string, trackingId: string): Promise<EscrowRecord> {
        return this.prisma.escrow.update({ where: { id }, data: { trackingId } });
      }

      // Pagination helper used by upstream
      findVendorEscrows(
        vendorAddress: string,
        state: string | undefined,
        sort: 'date' | 'amount',
        order: 'asc' | 'desc',
        page: number,
        limit: number,
      ): Promise<{ data: EscrowRecord[]; total: number }> {
        return this.prisma.escrow.findMany({
          where: { vendorAddress, state: state as any },
        }).then((records) => {
          const sorted = records.sort((a, b) => {
            const primary = sort === 'amount' ? a.amount - b.amount :
              a.createdAt.getTime() - b.createdAt.getTime();
            return order === 'asc' ? primary : -primary;
          });

          const total = sorted.length;
          const start = (page - 1) * limit;
          const data = sorted.slice(start, start + limit);
          return { data, total };
        });
      }

      markShipped(id: string, trackingId: string): Promise<EscrowRecord> {
        return this.prisma.escrow.update({
          where: { id },
          data: { state: 'SHIPPED', trackingId, shippedAt: new Date() },
        });
      }

      markCompleted(id: string): Promise<EscrowRecord> {
        return this.prisma.escrow.update({
          where: { id },
          data: { state: 'COMPLETED' },
        });
      }

      markRefunded(id: string): Promise<EscrowRecord> {
        return this.prisma.escrow.update({
          where: { id },
          data: { state: 'REFUNDED' },
        });
      }

      markReleased(id: string): Promise<EscrowRecord> {
        return this.prisma.escrow.update({
          where: { id },
          data: { state: 'RELEASED' },
        });
      }

      findAutoReleaseEligible(cutoffDate: Date): Promise<EscrowRecord[]> {
        return this.prisma.escrow.findMany({
          where: { state: 'SHIPPED', shippedAt: { lte: cutoffDate } },
        });
      }

      markDelivered(id: string, deliveredAt = new Date()): Promise<EscrowRecord> {
        return this.prisma.escrow.update({
          where: { id },
          data: {
            state: 'DELIVERED',
            deliveredAt,
            deliveryRecordedAt: deliveredAt,
          },
        });
      }

      markAutoReleaseCompleted(
        id: string,
        txHash: string,
        submittedAt = new Date(),
      ): Promise<EscrowRecord> {
        return this.prisma.escrow.update({
          where: { id },
          data: {
            state: 'COMPLETED',
            autoReleaseSubmittedAt: submittedAt,
            autoReleaseTxHash: txHash,
          },
        });
      }

      findShippedWithTracking(): Promise<EscrowRecord[]> {
        return this.prisma.escrow
          .findMany({ where: { state: 'SHIPPED' } })
          .then((escrows) =>
            escrows.filter((escrow) => Boolean(escrow.trackingId)),
          );
      }

      findAutoReleaseEligible(referenceTime = new Date()): Promise<EscrowRecord[]> {
        const threshold = new Date(referenceTime.getTime() - 48 * 60 * 60 * 1000);

        return this.prisma.escrow
          .findMany({ where: { state: 'SHIPPED' } })
          .then((escrows) =>
            escrows.filter(
              (escrow) =>
                escrow.deliveredAt !== null &&
                escrow.deliveredAt <= threshold &&
                escrow.disputeId === null &&
                escrow.autoReleaseTxHash === null,
            ),
          );
      }
    }
