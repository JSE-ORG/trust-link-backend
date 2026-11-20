import { Injectable, NotFoundException } from '@nestjs/common';
import { EscrowRepository } from '../../escrow/escrow.repository';
import type { DisputeRecord, EscrowRecord } from '../../prisma/prisma.service';
import { AdminEscrowsQueryDto } from './dto/admin-escrows-query.dto';

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

  async list(query: AdminEscrowsQueryDto): Promise<{
    data: AdminEscrowView[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.escrowRepository.findEscrows(
      {
        state: query.state,
        vendorAddress: query.vendorAddress,
        buyerAddress: query.buyerAddress,
        from: query.from,
        to: query.to,
      },
      'date',
      'desc',
      page,
      limit,
    );
    return { data: data.map(toAdminView), total, page, limit };
  }

  async get(
    id: string,
  ): Promise<AdminEscrowView & { dispute: DisputeRecord | null }> {
    const found = await this.escrowRepository.findByIdWithDispute(id);
    if (!found) throw new NotFoundException(`Escrow ${id} not found`);
    return { ...toAdminView(found.escrow), dispute: found.dispute };
  }
}
