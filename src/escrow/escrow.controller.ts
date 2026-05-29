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
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { EscrowService } from './escrow.service';
import { BuyerDisputeService } from './buyer-dispute.service';
import { RateLimit } from '../common/decorators/rate-limit.decorator';

@Controller('escrow')
export class EscrowController {
  constructor(
    private readonly escrowService: EscrowService,
    private readonly buyerDisputeService: BuyerDisputeService,
  ) {}

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

  @Get(':id/events')
  @RateLimit({ windowMs: 60000, max: 100 })
  getEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getEvents(id);
  }

  @Get(':id/tracking')
  @RateLimit({ windowMs: 60000, max: 200 }) // 200 requests per minute
  async getTracking(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getTracking(id);
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

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @RateLimit({ windowMs: 60000, max: 10 })
  cancelEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.cancelEscrow(id, user.address);
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @RateLimit({ windowMs: 60000, max: 5 })
  openDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDisputeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.buyerDisputeService.openDispute(id, user.address, dto);
  }

  @Get(':id/dispute')
  @UseGuards(JwtGuard)
  @RateLimit({ windowMs: 60000, max: 30 })
  getDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.buyerDisputeService.getDispute(id, user.address);
  }
}
