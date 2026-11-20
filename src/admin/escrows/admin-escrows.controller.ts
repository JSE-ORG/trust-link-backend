import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
import { AdminEscrowsService } from './admin-escrows.service';
import { AdminEscrowsQueryDto } from './dto/admin-escrows-query.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminEscrowsController {
  constructor(private readonly adminEscrows: AdminEscrowsService) {}

  @ApiOperation({ summary: 'List escrows (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of escrows.' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('escrows')
  async list(@Query() query: AdminEscrowsQueryDto) {
    return this.adminEscrows.list(query);
  }

  @ApiOperation({ summary: 'Get one escrow with its dispute (admin only)' })
  @ApiResponse({ status: 200, description: 'Escrow and its dispute, if any.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('escrows/:id')
  async get(@Param('id') id: string) {
    return this.adminEscrows.get(id);
  }
}
