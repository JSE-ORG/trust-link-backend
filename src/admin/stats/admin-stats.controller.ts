import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminService } from '../admin.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/stats')
@UseGuards(JwtGuard, AdminGuard)
export class AdminStatsController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({ summary: 'Get platform-wide statistics (admin only)' })
  @ApiResponse({ status: 200, description: 'Aggregated platform stats returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @Get()
  getStats() {
    return this.adminService.getPlatformStats();
  }
}
