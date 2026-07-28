import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { AdminGuard } from '../guards/admin.guard';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeService } from './dispute.service';
import { DisputeResponseDto } from '../../escrow/dto/dispute-response.dto';
import { AdminDisputesPaginatedResponseDto } from './dto/admin-disputes-paginated-response.dto';
import { AuditLogEntryDto } from '../stats/dto/audit-log-entry.dto';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

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
  @ApiOkResponse({
    description: 'Paginated dispute list returned.',
    type: AdminDisputesPaginatedResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Admin access required.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Get('disputes')
  async getDisputes(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.disputeService.getDisputes({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @ApiOperation({
    summary: 'Resolve a dispute by releasing or refunding the escrow',
  })
  @ApiOkResponse({
    description: 'Dispute resolved, escrow state updated.',
    type: DisputeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid resolution value.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Admin access required.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — dispute is not in OPEN state.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Patch('dispute/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() admin: AuthUser,
  ) {
    const result = await this.disputeService.resolve(id, dto.resolution);
    this.auditLogService.append({
      action: 'DISPUTE_RESOLVED',
      adminAddress: admin.address,
      entityType: 'escrow',
      entityId: id,
      details: { resolution: dto.resolution },
    });
    return result;
  }

  @ApiOperation({ summary: 'Get admin audit log entries' })
  @ApiOkResponse({
    description: 'Audit log returned.',
    type: [AuditLogEntryDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Admin access required.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Get('audit-log')
  getAuditLog() {
    return this.auditLogService.findAll();
  }
}
