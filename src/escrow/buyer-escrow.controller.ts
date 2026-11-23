import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../common/security/throttle.config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { EscrowService } from './escrow.service';
import { VendorEscrowsQueryDto } from './dto/vendor-escrows-query.dto';
import { VendorEscrowsPaginatedResponseDto } from './dto/vendor-escrows-paginated-response.dto';

/**
 * GET /buyer/escrows: the authenticated buyer's escrows. Same query shape and
 * response as the vendor list; the buyer address always comes from the JWT.
 */
@ApiTags('Buyer')
@ApiBearerAuth()
@Controller('buyer')
@UseGuards(JwtGuard)
export class BuyerEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  /**
   * Lists escrows associated with the authenticated buyer.
   *
   * @param query Filtering, sorting, and pagination criteria.
   * @param user Authenticated buyer user.
   * @returns Paginated list of buyer escrows.
   * @throws BadRequestException if query parameters fail validation.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   */
  @ApiOperation({ summary: 'List all escrows for the authenticated buyer' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of buyer escrows returned.',
    type: VendorEscrowsPaginatedResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('escrows')
  async getEscrows(
    @Query() query: VendorEscrowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.findBuyerEscrows(user.address, query);
  }

  /**
   * Exports the buyer's escrows as CSV, newest first, using the same filters
   * as the list. Capped at 10,000 rows; cells that could run as spreadsheet
   * formulas are escaped. Carries `vendorAddress` in place of `buyerAddress`.
   *
   * @param query Filtering and sorting criteria for export.
   * @param user Authenticated buyer user.
   * @returns CSV formatted file string.
   * @throws BadRequestException if query parameters fail validation.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   */
  @ApiOperation({ summary: 'Export buyer escrows as CSV (max 10,000 rows)' })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file.' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 5, ttl: THROTTLE_WINDOW_MS } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="escrows.csv"')
  @Get('escrows/export')
  async exportEscrows(
    @Query() query: VendorEscrowsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<string> {
    return this.escrowService.exportBuyerEscrowsCsv(user.address, query);
  }
}
