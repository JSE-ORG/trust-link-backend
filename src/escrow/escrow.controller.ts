import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { UpdateBuyerContactDto } from './dto/update-buyer-contact.dto';
import { EscrowService } from './escrow.service';
import { BuyerDisputeService } from './buyer-dispute.service';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@SkipThrottle({ auth: true }) // Skip auth limit for escrow endpoints
@Controller('escrow')
export class EscrowController {
  constructor(
    private readonly escrowService: EscrowService,
    private readonly buyerDisputeService: BuyerDisputeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  createEscrow(@Body() dto: CreateEscrowDto, @CurrentUser() user: AuthUser) {
    return this.escrowService.createEscrow(dto, user.address);
  }

  @Post('evidence-upload')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle('evidence-upload')
  evidenceUpload(
    @Query('fileName') fileName: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.generateEvidenceUploadUrl(user.address, fileName);
  }

  @Get(':id')
  getEscrow(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getPublicEscrow(id);
  }

  @Get(':id/events')
  @Throttle({ public: { limit: 100, ttl: 60000 } })
  getEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getEvents(id);
  }

  @Get(':id/tracking')
  async getTracking(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getTracking(id);
  }

  // ── Issue #28 ─────────────────────────────────────────────────────────────
  // No JwtGuard: the buyer is not authenticated via SEP-10 at payment time.
  // The endpoint is intentionally unauthenticated — the escrow ID in the URL
  // acts as the possession proof (it was shared with the buyer by the vendor).
  // Rate-limited tightly to prevent enumeration.
  @Patch(':id/buyer-contact')
  @HttpCode(HttpStatus.OK)
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  updateBuyerContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyerContactDto,
  ) {
    return this.escrowService.updateBuyerContact(id, dto);
  }

  @Patch(':id/ship')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 20, ttl: 60000 } })
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
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  cancelEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.cancelEscrow(id, user.address);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  cancelPendingEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.cancelPendingEscrow(id, user.address);
  }

  @Post(':id/dispute')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 5, ttl: 60000 } })
  openDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDisputeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.buyerDisputeService.openDispute(id, user.address, dto);
  }

  @Get(':id/dispute')
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 30, ttl: 60000 } })
  getDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.buyerDisputeService.getDispute(id, user.address);
  }
}
