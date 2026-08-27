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
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../common/security/throttle.config';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { DlqService } from './dlq.service';
import type {
  FailedTransactionStatus,
  ListFailedTransactionsQuery,
} from './dlq.types';
import { ContractService } from '../stellar/contract.service';
import {
  AutoReleaseSourceNotConfiguredError,
  ConfigService,
} from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

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
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns the auto-release signing address, translating the shared
   * "not configured" error into a 503 for this HTTP path (#672).
   *
   * The check itself lives in `ConfigService.requireAutoReleaseSourceAddress`
   * and is resolved on use, not at construction: `AUTO_RELEASE_SOURCE_ADDRESS`
   * is optional in `config.module.ts`, so a constructor throw would stop Nest
   * from instantiating this controller and take the whole app down. Here only
   * the replay endpoint degrades, and it does so with a clear 503.
   */
  private requireAutoReleaseSource(): string {
    try {
      return this.config.requireAutoReleaseSourceAddress();
    } catch (err) {
      if (err instanceof AutoReleaseSourceNotConfiguredError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
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
  @ApiOperation({
    summary:
      'List failed contract transactions available for review and replay',
  })
  @ApiResponse({
    status: 200,
    description: 'Failed transaction records returned.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiQuery({ name: 'status', required: false, example: 'failed' })
  @ApiQuery({
    name: 'operation',
    required: false,
    example: 'submitAutoRelease',
  })
  @ApiQuery({
    name: 'escrowId',
    required: false,
    example: '9d9e2e16-0c78-4a84-9c8c-0f3a5eb2d4e3',
  })
  @Throttle({ auth: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
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

  @ApiOperation({ summary: 'Get details for a failed transaction record' })
  @ApiResponse({
    status: 200,
    description: 'Failed transaction record returned.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({
    status: 404,
    description: 'Failed transaction record not found.',
  })
  @ApiParam({ name: 'id', example: 'abc123-def4-5678-90ab-cdef12345678' })
  @Throttle({ auth: { limit: 30, ttl: THROTTLE_WINDOW_MS } })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.dlq.get(id);
  }

  /**
   * Re-execute the original operation. Today the only auto-retryable operation
   * is auto-release; other operations are flagged and must be replayed by
   * hand. Either way the record is updated on the outcome.
   */
  @ApiOperation({ summary: 'Replay a failed on-chain transaction attempt' })
  @ApiResponse({
    status: 200,
    description: 'Replay request accepted and replay execution started.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({
    status: 404,
    description: 'Failed transaction record not found.',
  })
  @ApiParam({ name: 'id', example: 'abc123-def4-5678-90ab-cdef12345678' })
  @Throttle({ auth: { limit: 5, ttl: THROTTLE_WINDOW_MS } })
  @Post(':id/replay')
  async replay(@Param('id') id: string) {
    const record = await this.dlq.get(id);
    return this.dlq.replay(record.id, async (r) => {
      if (r.operation === 'submitAutoRelease' && r.escrowId) {
        // `auto_release(env, escrow_id: u64)` takes the contract's own id.
        // The DLQ record carries the backend UUID, so it has to be translated
        // before replay; without a mapping there is no valid call to make.
        const escrow = await this.prisma.escrow.findUnique({
          where: { id: r.escrowId },
          select: { contractEscrowId: true },
        });
        if (!escrow?.contractEscrowId) {
          throw new Error(
            `Escrow "${r.escrowId}" has no contractEscrowId, so auto-release ` +
              `cannot be replayed on-chain.`,
          );
        }
        return this.contract.submitAutoRelease(
          escrow.contractEscrowId,
          this.requireAutoReleaseSource(),
        );
      }
      throw new Error(
        `Operation "${r.operation}" cannot be replayed automatically; replay manually.`,
      );
    });
  }

  @ApiOperation({
    summary:
      'Abandon a failed transaction record and prevent future replay attempts',
  })
  @ApiResponse({
    status: 200,
    description: 'Failed transaction record abandoned.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({
    status: 404,
    description: 'Failed transaction record not found.',
  })
  @ApiParam({ name: 'id', example: 'abc123-def4-5678-90ab-cdef12345678' })
  @Throttle({ auth: { limit: 5, ttl: THROTTLE_WINDOW_MS } })
  @Post(':id/abandon')
  abandon(@Param('id') id: string) {
    return this.dlq.abandon(id);
  }
}
