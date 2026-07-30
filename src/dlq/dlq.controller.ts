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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
  @ApiOperation({ summary: 'List failed contract transactions available for review and replay' })
  @ApiResponse({ status: 200, description: 'Failed transaction records returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiQuery({ name: 'status', required: false, example: 'failed' })
  @ApiQuery({ name: 'operation', required: false, example: 'submitAutoRelease' })
  @ApiQuery({ name: 'escrowId', required: false, example: '9d9e2e16-0c78-4a84-9c8c-0f3a5eb2d4e3' })
  @Throttle({ auth: { limit: 20, ttl: 60000 } })
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
  @ApiResponse({ status: 200, description: 'Failed transaction record returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Failed transaction record not found.' })
  @ApiParam({ name: 'id', example: 'abc123-def4-5678-90ab-cdef12345678' })
  @Throttle({ auth: { limit: 30, ttl: 60000 } })
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
  @ApiResponse({ status: 200, description: 'Replay request accepted and replay execution started.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Failed transaction record not found.' })
  @ApiParam({ name: 'id', example: 'abc123-def4-5678-90ab-cdef12345678' })
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
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

  @ApiOperation({ summary: 'Abandon a failed transaction record and prevent future replay attempts' })
  @ApiResponse({ status: 200, description: 'Failed transaction record abandoned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Failed transaction record not found.' })
  @ApiParam({ name: 'id', example: 'abc123-def4-5678-90ab-cdef12345678' })
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @Post(':id/abandon')
  abandon(@Param('id') id: string) {
    return this.dlq.abandon(id);
  }
}
