import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeService } from './dispute.service';

@Controller('admin/dispute')
@UseGuards(JwtGuard, AdminGuard)
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.disputeService.resolve(id, dto.resolution);
  }
}
