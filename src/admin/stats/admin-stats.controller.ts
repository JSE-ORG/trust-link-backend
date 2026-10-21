import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../../common/security/throttle.config';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsDto } from './dto/admin-stats.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/stats')
@UseGuards(JwtGuard, AdminGuard)
export class AdminStatsController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  @ApiOperation({ summary: 'Get platform-wide statistics (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Aggregated platform stats returned.',
    type: AdminStatsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get()
  getStats() {
    return this.adminStatsService.getStats();
  }
}
