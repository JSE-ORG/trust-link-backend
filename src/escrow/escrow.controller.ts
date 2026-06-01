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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { EscrowService } from './escrow.service';
import { BuyerDisputeService } from './buyer-dispute.service';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@ApiTags('Escrow')
@ApiBearerAuth()
@SkipThrottle({ auth: true })
@Controller('escrow')
export class EscrowController {
  constructor(
    private readonly escrowService: EscrowService,
    private readonly buyerDisputeService: BuyerDisputeService,
  ) {}

  @ApiOperation({ summary: 'Create a new escrow' })
  @ApiResponse({ status: 201, description: 'Escrow created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid request body.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  createEscrow(@Body() dto: CreateEscrowDto, @CurrentUser() user: AuthUser) {
    return this.escrowService.createEscrow(dto, user.address);
  }

  @ApiOperation({ summary: 'Generate pre-signed S3 URL for evidence upload' })
  @ApiResponse({ status: 201, description: 'Pre-signed upload URL returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Post('evidence-upload')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 30, ttl: 60000 } })
  evidenceUpload(
    @Query('fileName') fileName: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.generateEvidenceUploadUrl(user.address, fileName);
  }

  @ApiOperation({ summary: 'Get escrow by ID' })
  @ApiResponse({ status: 200, description: 'Escrow record returned.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  getEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.escrowService.getEscrowForViewer(id, user?.address);
  }

  @ApiOperation({ summary: 'Get Stellar contract events for an escrow' })
  @ApiResponse({ status: 200, description: 'Event list returned.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @Get(':id/events')
  @Throttle({ public: { limit: 100, ttl: 60000 } })
  getEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getEvents(id);
  }

  @ApiOperation({ summary: 'Get shipment tracking info for an escrow' })
  @ApiResponse({ status: 200, description: 'Tracking data returned.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @Get(':id/tracking')
  async getTracking(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getTracking(id);
  }

  @ApiOperation({ summary: 'Mark escrow as shipped with tracking ID' })
  @ApiResponse({ status: 200, description: 'Escrow updated to SHIPPED state.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Not the vendor for this escrow.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
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

  @ApiOperation({ summary: 'Cancel an escrow (buyer or vendor)' })
  @ApiResponse({ status: 200, description: 'Escrow cancelled.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Not a participant in this escrow.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
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

  @ApiOperation({ summary: 'Delete a pending escrow before it is funded' })
  @ApiResponse({ status: 200, description: 'Pending escrow deleted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
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

  @ApiOperation({ summary: 'Open a dispute for an escrow' })
  @ApiResponse({ status: 201, description: 'Dispute opened successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid dispute payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Not a participant in this escrow.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
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

  @ApiOperation({ summary: 'Get the active dispute for an escrow' })
  @ApiResponse({ status: 200, description: 'Dispute record returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Not a participant in this escrow.' })
  @ApiResponse({ status: 404, description: 'No dispute found for this escrow.' })
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
