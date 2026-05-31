import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { AdminGuard } from '../guards/admin.guard';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeService } from './dispute.service';

@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class DisputeController {
  constructor(
    private readonly disputeService: DisputeService,
    private readonly auditLogService: AuditLogService,
  ) {}

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

  @Get('audit-log')
  getAuditLog() {
    return this.auditLogService.findAll();
  }
}
