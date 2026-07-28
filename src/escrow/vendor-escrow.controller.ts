import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { EscrowService } from './escrow.service';
import { VendorEscrowsQueryDto } from './dto/vendor-escrows-query.dto';
import { VendorEscrowsPaginatedResponseDto } from './dto/vendor-escrows-paginated-response.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor')
export class VendorEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  /**
   * Returns a paginated list of escrows for the authenticated vendor.
   * Supports filtering by state, sorting by date or amount, and
   * pagination with configurable page size.
   *
   * @param query - Query parameters for filtering, sorting and pagination
   * @param user - Authenticated vendor
   * @returns Paginated escrow summary list with total count
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'List all escrows for the authenticated vendor' })
  @ApiOkResponse({
    description: 'Paginated list of vendor escrows returned.',
    type: VendorEscrowsPaginatedResponseDto,
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
    status: 429,
    description: 'Too many requests.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtGuard)
  @Get('escrows')
  async getEscrows(
    @Query() query: VendorEscrowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.findVendorEscrows(user.address, query);
  }
}
