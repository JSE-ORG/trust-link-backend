import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { EscrowService } from './escrow.service';
import { VendorEscrowsQueryDto } from './dto/vendor-escrows-query.dto';

@Controller('vendor')
export class VendorEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @UseGuards(JwtGuard)
  @Get('escrows')
  async getEscrows(
    @Query() query: VendorEscrowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.findVendorEscrows(user.address, query);
  }
}
