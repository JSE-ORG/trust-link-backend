import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../../common/security/throttle.config';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { AdminGuard } from '../guards/admin.guard';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeService } from './dispute.service';
import { AdminDisputesPaginatedResponseDto } from './dto/admin-disputes-paginated-response.dto';
import { AdminAuditLogPaginatedResponseDto } from './dto/admin-audit-log-paginated-response.dto';
import { EscrowResponseDto } from '../../escrow/dto/escrow-response.dto';
import { AdminDisputesQueryDto } from './dto/admin-disputes-query.dto';
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class DisputeController {
  constructor(
    private readonly disputeService: DisputeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @ApiOperation({ summary: 'List all disputes (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated dispute list returned.',
    type: AdminDisputesPaginatedResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('disputes')
  async getDisputes(@Query() query: AdminDisputesQueryDto) {
    return this.disputeService.getDisputes(query);
  }

  @ApiOperation({
    summary: 'Resolve a dispute by releasing or refunding the escrow',
  })
  @ApiResponse({
    status: 200,
    description: 'Dispute resolved, escrow state updated.',
    type: EscrowResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid resolution value.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  @Patch('dispute/:id/resolve')
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() admin: AuthUser,
  ) {
    const result = await this.disputeService.resolve(id, dto.resolution);
    await this.auditLogService.append({
      action: 'DISPUTE_RESOLVED',
      adminAddress: admin.address,
      entityType: 'escrow',
      entityId: id,
      details: { resolution: dto.resolution },
    });
    return result;
  }

  @ApiOperation({ summary: 'Export admin audit log as CSV' })
  @ApiResponse({
    status: 200,
    description: 'CSV export of admin audit log returned.',
    content: { 'text/csv': {} },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  @Get('audit-log/export')
  async exportAuditLog(
    @Query() query: AdminAuditLogQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.auditLogService.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="audit-log.csv"',
    );
    return csv;
  }

  @ApiOperation({ summary: 'Get admin audit log entries' })
  @ApiResponse({
    status: 200,
    description: 'Paginated audit log returned.',
    type: AdminAuditLogPaginatedResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('audit-log')
  async getAuditLog(@Query() query: AdminAuditLogQueryDto) {
    return this.auditLogService.findAll(query);
  }
}
