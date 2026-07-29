import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsDto } from './dto/admin-stats.dto';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/stats')
@UseGuards(JwtGuard, AdminGuard)
export class AdminStatsController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  @ApiOperation({ summary: 'Get platform-wide statistics (admin only)' })
  @ApiOkResponse({
    description: 'Aggregated platform stats returned.',
    type: AdminStatsDto,
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
  @Get()
  getStats() {
    return this.adminStatsService.getStats();
  }
}
