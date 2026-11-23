import { Injectable, NotFoundException } from '@nestjs/common';
import { EscrowRepository } from '../../escrow/escrow.repository';
import type { DisputeRecord, EscrowRecord } from '../../prisma/prisma.service';
import { AdminEscrowsQueryDto } from './dto/admin-escrows-query.dto';
import {
  buildPaginatedEnvelope,
  PaginatedEnvelope,
} from '../../common/pagination/pagination.helper';
import {
  ADMIN_ESCROW_CSV_COLUMNS,
  escrowsToCsv,
} from '../../escrow/escrow-csv';
import { ESCROW_EXPORT_MAX_ROWS } from '../../escrow/escrow.constants';

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

  /**
   * Lists escrows matching administrative query filters with pagination.
   *
   * @param query Admin query filters and pagination parameters.
   * @returns Paginated envelope containing transformed admin escrow views.
   */
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

  /** Same filters as {@link list}, capped at {@link ESCROW_EXPORT_MAX_ROWS} rows, ignoring paging. */
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
      ESCROW_EXPORT_MAX_ROWS,
    );
    return escrowsToCsv(data, ADMIN_ESCROW_CSV_COLUMNS);
  }

  /**
   * Retrieves an escrow by UUID including its associated dispute, if any.
   *
   * @param id Escrow UUID.
   * @returns Admin escrow view with optional dispute record.
   * @throws NotFoundException if the escrow is not found.
   */
  async get(
    id: string,
  ): Promise<AdminEscrowView & { dispute: DisputeRecord | null }> {
    const found = await this.escrowRepository.findByIdWithDispute(id);
    if (!found) throw new NotFoundException(`Escrow ${id} not found`);
    return { ...toAdminView(found.escrow), dispute: found.dispute };
  }
}
