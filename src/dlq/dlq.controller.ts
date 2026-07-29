import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { DlqService } from './dlq.service';
import type {
  FailedTransactionStatus,
  ListFailedTransactionsQuery,
} from './dlq.types';
import { ContractService } from '../stellar/contract.service';
import { ConfigService } from '../config/config.service';

/**
 * Admin endpoints for reviewing and re-executing failed Stellar contract
 * submissions (#74).
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/dlq')
@UseGuards(JwtGuard, AdminGuard)
export class DlqController {
  /** Stellar address of the auto-release signing account used to replay `submitAutoRelease`. */
  constructor(
    private readonly dlq: DlqService,
    private readonly contract: ContractService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns the auto-release signing address, or throws if it is not configured.
   *
   * Resolved on use rather than in the constructor. `AUTO_RELEASE_SOURCE_ADDRESS`
   * is declared optional in `config.module.ts`, so throwing at construction made
   * an optional variable mandatory for the whole application: Nest could not
   * instantiate this controller, so `NestFactory.create` failed and nothing
   * booted, including `npm run start` and the OpenAPI generation script.
   *
   * Failing here instead keeps the failure proportionate. Only the replay
   * endpoint is unavailable, and it still fails loudly with a clear message.
   */
  private requireAutoReleaseSource(): string {
    const address = this.config.get<string>('AUTO_RELEASE_SOURCE_ADDRESS');
    if (!address) {
      throw new ServiceUnavailableException(
        'AUTO_RELEASE_SOURCE_ADDRESS is not configured, so auto-release replay is unavailable.',
      );
    }
    return address;
  }

  @ApiOperation({ summary: 'List failed transactions (admin DLQ)' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by transaction status',
  })
  @ApiQuery({
    name: 'operation',
    required: false,
    description: 'Filter by operation name',
  })
  @ApiQuery({
    name: 'escrowId',
    required: false,
    description: 'Filter by escrow ID',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum records per page (default 20, max 100)',
  })
  @Get()
  list(
    @Query('status') status?: FailedTransactionStatus,
    @Query('operation') operation?: string,
    @Query('escrowId') escrowId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const query: ListFailedTransactionsQuery = {};
    if (status) query.status = status;
    if (operation) query.operation = operation;
    if (escrowId) query.escrowId = escrowId;
    if (page) query.page = parseInt(page, 10);
    if (limit) query.limit = parseInt(limit, 10);
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
  async replay(@Param('id') id: string) {
    const record = await this.dlq.get(id);
    return this.dlq.replay(record.id, async (r) => {
      if (r.operation === 'submitAutoRelease' && r.escrowId) {
        return this.contract.submitAutoRelease(
          r.escrowId,
          this.requireAutoReleaseSource(),
        );
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
