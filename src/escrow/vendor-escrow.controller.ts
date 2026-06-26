import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { EscrowService } from './escrow.service';
import { VendorEscrowsQueryDto } from './dto/vendor-escrows-query.dto';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor')
export class VendorEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @ApiOperation({ summary: 'List all escrows for the authenticated vendor' })
  @ApiResponse({ status: 200, description: 'Paginated list of vendor escrows returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @UseGuards(JwtGuard)
  @Get('escrows')
  async getEscrows(
    @Query() query: VendorEscrowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.findVendorEscrows(user.address, query);
  }
}
