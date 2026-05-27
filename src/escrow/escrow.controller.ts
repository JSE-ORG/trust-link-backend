import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { EscrowService } from './escrow.service';
import { RateLimit } from '../common/decorators/rate-limit.decorator';

@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ windowMs: 60000, max: 10 }) // 10 requests per minute
  createEscrow(@Body() dto: CreateEscrowDto, @CurrentUser() user: AuthUser) {
    return this.escrowService.createEscrow(dto, user.address);
  }

  @Get(':id')
  @RateLimit({ windowMs: 60000, max: 100 }) // 100 requests per minute
  getEscrow(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.findById(id);
  }

  @Patch(':id/ship')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ windowMs: 60000, max: 20 }) // 20 requests per minute
  shipEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.handleShipment(id, user.address, dto.trackingId);
  }
}
