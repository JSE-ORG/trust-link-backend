import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { DlqService } from './dlq.service';
import type { FailedTransactionStatus, ListFailedTransactionsQuery } from './dlq.types';
import { ContractService } from '../stellar/contract.service';

interface ReplayBody {
  /** Optional override for the operation the replay should run. */
  operation?: string;
}

/**
 * Admin endpoints for reviewing and re-executing failed Stellar contract
 * submissions (#74).
 */
@Controller('admin/dlq')
@UseGuards(JwtGuard, AdminGuard)
export class DlqController {
  constructor(
    private readonly dlq: DlqService,
    private readonly contract: ContractService,
  ) {}

  @Get()
  list(
    @Query('status') status?: FailedTransactionStatus,
    @Query('operation') operation?: string,
    @Query('escrowId') escrowId?: string,
  ) {
    const query: ListFailedTransactionsQuery = {};
    if (status) query.status = status;
    if (operation) query.operation = operation;
    if (escrowId) query.escrowId = escrowId;
    return this.dlq.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.dlq.get(id);
  }

  /**
   * Re-execute the original operation. Today the only auto-retryable operation
   * is auto-release; other operations are flagged and must be replayed by
   * hand. Either way the record is updated on the outcome.
   */
  @Post(':id/replay')
  async replay(@Param('id') id: string, @Body() _body: ReplayBody = {}) {
    const record = this.dlq.get(id);
    return this.dlq.replay(record.id, async (r) => {
      if (r.operation === 'submitAutoRelease' && r.escrowId) {
        return this.contract.submitAutoRelease(r.escrowId);
      }
      throw new Error(
        `Operation "${r.operation}" cannot be replayed automatically; replay manually.`,
      );
    });
  }

  @Post(':id/abandon')
  abandon(@Param('id') id: string) {
    return this.dlq.abandon(id);
  }
}
