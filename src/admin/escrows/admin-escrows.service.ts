import { Injectable, NotFoundException } from '@nestjs/common';
import { EscrowRepository } from '../../escrow/escrow.repository';
import type { DisputeRecord, EscrowRecord } from '../../prisma/prisma.service';
import { AdminEscrowsQueryDto } from './dto/admin-escrows-query.dto';
import {
  buildPaginatedEnvelope,
  PaginatedEnvelope,
} from '../../common/pagination/pagination.helper';
import { escrowsToCsv } from '../../escrow/escrow-csv';

/** An escrow as admins see it: every column except the encrypted contact fields. */
export type AdminEscrowView = Omit<
  EscrowRecord,
  'buyerContactEmail' | 'buyerContactPhone' | 'contractEscrowId'
> & { contractEscrowId: string | null };

function toAdminView(escrow: EscrowRecord): AdminEscrowView {
  const view: Partial<EscrowRecord> = { ...escrow };
  delete view.buyerContactEmail;
  delete view.buyerContactPhone;
  const { contractEscrowId } = escrow;
  return {
    ...(view as Omit<EscrowRecord, 'buyerContactEmail' | 'buyerContactPhone'>),
    contractEscrowId:
      contractEscrowId === null || contractEscrowId === undefined
        ? null
        : contractEscrowId.toString(),
  };
}

@Injectable()
export class AdminEscrowsService {
  constructor(private readonly escrowRepository: EscrowRepository) {}

  async list(
    query: AdminEscrowsQueryDto,
  ): Promise<PaginatedEnvelope<AdminEscrowView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.escrowRepository.findEscrows(
      {
        state: query.state,
        vendorAddress: query.vendorAddress,
        buyerAddress: query.buyerAddress,
        from: query.from,
        to: query.to,
        q: query.q,
      },
      query.sort ?? 'date',
      query.order ?? 'desc',
      page,
      limit,
    );
    return buildPaginatedEnvelope(data.map(toAdminView), total, page, limit);
  }

  /** Same filters as {@link list}, capped at 10,000 rows, ignoring paging. */
  async exportCsv(query: AdminEscrowsQueryDto): Promise<string> {
    const { data } = await this.escrowRepository.findEscrows(
      {
        state: query.state,
        vendorAddress: query.vendorAddress,
        buyerAddress: query.buyerAddress,
        from: query.from,
        to: query.to,
        q: query.q,
      },
      query.sort ?? 'date',
      query.order ?? 'desc',
      1,
      10_000,
    );
    return escrowsToCsv(data);
  }

  async get(
    id: string,
  ): Promise<AdminEscrowView & { dispute: DisputeRecord | null }> {
    const found = await this.escrowRepository.findByIdWithDispute(id);
    if (!found) throw new NotFoundException(`Escrow ${id} not found`);
    return { ...toAdminView(found.escrow), dispute: found.dispute };
  }
}
