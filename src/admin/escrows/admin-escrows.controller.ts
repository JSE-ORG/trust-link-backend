import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
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

  /**
   * Lists escrows across all buyers and vendors with pagination and filters.
   *
   * @param query Admin escrow filtering and pagination parameters.
   * @returns Paginated list of escrows.
   * @throws BadRequestException if query parameters fail validation.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
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

  /**
   * Exports matching escrows as a CSV file download.
   *
   * @param query Query filters matching the escrows to export.
   * @returns CSV file content.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
  @ApiOperation({ summary: 'Export escrows as CSV (admin only)' })
  @ApiResponse({ status: 200, description: 'CSV of matching escrows.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 5, ttl: THROTTLE_WINDOW_MS } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="escrows.csv"')
  @Get('escrows/export')
  async exportCsv(@Query() query: AdminEscrowsQueryDto): Promise<string> {
    return this.adminEscrows.exportCsv(query);
  }

  /**
   * Retrieves a single escrow along with its dispute details, if any.
   *
   * @param id Unique identifier of the escrow.
   * @returns Escrow record and optional dispute information.
   * @throws NotFoundException if the escrow is not found.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
  @ApiOperation({ summary: 'Get one escrow with its dispute (admin only)' })
  @ApiResponse({ status: 200, description: 'Escrow and its dispute, if any.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('escrows/:id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminEscrows.get(id);
  }
}
