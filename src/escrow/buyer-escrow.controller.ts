import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../common/security/throttle.config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { EscrowService } from './escrow.service';
import { VendorEscrowsQueryDto } from './dto/vendor-escrows-query.dto';
import { VendorEscrowsPaginatedResponseDto } from './dto/vendor-escrows-paginated-response.dto';

/**
 * GET /buyer/escrows — list all escrows for the authenticated buyer (#1148).
 * Uses the same query shape and response as the vendor list; the buyer address
 * is taken from the JWT so a buyer can never see another buyer's escrows.
 */
@ApiTags('Buyer')
@ApiBearerAuth()
@Controller('buyer')
@UseGuards(JwtGuard)
export class BuyerEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @ApiOperation({ summary: 'List all escrows for the authenticated buyer' })
  @ApiResponse({ status: 200, type: VendorEscrowsPaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('escrows')
  getEscrows(@Query() query: VendorEscrowsQueryDto, @CurrentUser() user: AuthUser) {
    return this.escrowService.findBuyerEscrows(user.address, query);
  }
}
