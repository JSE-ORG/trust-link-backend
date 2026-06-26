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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
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

@ApiTags('Escrow')
@SkipThrottle({ auth: true }) // Skip auth limit for escrow endpoints
@Controller('escrow')
export class EscrowController {
  constructor(
    private readonly escrowService: EscrowService,
    private readonly buyerDisputeService: BuyerDisputeService,
  ) {}

  @ApiOperation({ summary: 'Create a new escrow transaction' })
  @ApiResponse({ status: 201, description: 'Escrow created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  createEscrow(@Body() dto: CreateEscrowDto, @CurrentUser() user: AuthUser) {
    return this.escrowService.createEscrow(dto, user.address);
  }

  @ApiOperation({ summary: 'Generate a pre-signed URL for evidence file upload' })
  @ApiQuery({ name: 'fileName', description: 'Original file name for the evidence being uploaded.', example: 'damage-photo.jpg' })
  @ApiResponse({ status: 201, description: 'Pre-signed upload URL generated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
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

  @ApiOperation({ summary: 'Get public escrow details by ID' })
  @ApiResponse({ status: 200, description: 'Escrow details returned.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Get(':id')
  getEscrow(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getPublicEscrow(id);
  }

  @ApiOperation({ summary: 'Get all events for an escrow transaction' })
  @ApiResponse({ status: 200, description: 'List of escrow events returned.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Get(':id/events')
  @Throttle({ public: { limit: 100, ttl: 60000 } })
  getEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getEvents(id);
  }

  @ApiOperation({ summary: 'Get carrier tracking information for an escrow shipment' })
  @ApiResponse({ status: 200, description: 'Tracking information returned.' })
  @ApiResponse({ status: 404, description: 'Escrow not found or not yet shipped.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Get(':id/tracking')
  async getTracking(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getTracking(id);
  }

  // ── Issue #28 ─────────────────────────────────────────────────────────────
  // No JwtGuard: the buyer is not authenticated via SEP-10 at payment time.
  // The endpoint is intentionally unauthenticated — the escrow ID in the URL
  // acts as the possession proof (it was shared with the buyer by the vendor).
  // Rate-limited tightly to prevent enumeration.
  @ApiOperation({ summary: 'Update buyer contact details for an escrow' })
  @ApiResponse({ status: 200, description: 'Buyer contact updated.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Patch(':id/buyer-contact')
  @HttpCode(HttpStatus.OK)
  @Throttle({ public: { limit: 10, ttl: 60000 } })
  updateBuyerContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyerContactDto,
  ) {
    return this.escrowService.updateBuyerContact(id, dto);
  }

  @ApiOperation({ summary: 'Mark an escrow as shipped with a tracking ID' })
  @ApiResponse({ status: 200, description: 'Escrow marked as shipped.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
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

  @ApiOperation({ summary: 'Cancel an active escrow transaction' })
  @ApiResponse({ status: 200, description: 'Escrow cancelled.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
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

  @ApiOperation({ summary: 'Delete a pending (unfunded) escrow transaction' })
  @ApiResponse({ status: 200, description: 'Pending escrow deleted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
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

  @ApiOperation({ summary: 'Open a dispute for an escrow transaction' })
  @ApiResponse({ status: 201, description: 'Dispute opened successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Escrow not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
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

  @ApiOperation({ summary: 'Get the dispute record for an escrow transaction' })
  @ApiResponse({ status: 200, description: 'Dispute details returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Dispute not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiBearerAuth()
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
