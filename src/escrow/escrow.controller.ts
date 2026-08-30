import {
  BadRequestException,
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
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { UpdateBuyerContactDto } from './dto/update-buyer-contact.dto';
import { EscrowService } from './escrow.service';
import { BuyerDisputeService } from './buyer-dispute.service';
import { Throttle } from '@nestjs/throttler';
import {
  EVIDENCE_UPLOAD_THROTTLE,
  THROTTLE_WINDOW_MS,
} from '../common/security/throttle.config';
import { EscrowResponseDto } from './dto/escrow-response.dto';
import { EscrowWithPaymentUrlResponseDto } from './dto/escrow-with-payment-url-response.dto';
import { EvidenceUploadResponseDto } from './dto/evidence-upload.dto';
import { TrackingResponseDto } from './dto/tracking-response.dto';
import { BuyerContactUpdateResponseDto } from './dto/buyer-contact-update-response.dto';
import { EscrowEventEntryDto } from './dto/escrow-event-entry.dto';
import { DisputeResponseDto } from './dto/dispute-response.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Escrow')
@Controller('escrow')
export class EscrowController {
  constructor(
    private readonly escrowService: EscrowService,
    private readonly buyerDisputeService: BuyerDisputeService,
  ) {}

  /**
   * Creates a new escrow in the CREATED state.
   *
   * The escrow is initialized in CREATED state and awaits buyer payment.
   * A payment URL is returned for the buyer to complete the on-chain funding.
   * Once funded on-chain, the escrow transitions to FUNDED state.
   *
   * @param dto - Escrow details including item name, amount, currency and buyer address
   * @param user - Authenticated vendor making the request
   * @param idempotencyKey - UUID sent via the Idempotency-Key header, scoped per vendor
   * @returns Created escrow record with payment URL
   * @throws BadRequestException if amount is not positive, or the Idempotency-Key header is missing or not a UUID
   * @throws ConflictException if duplicate item reference exists
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   * @rateLimit 10 requests per 60 seconds
   */
  @ApiOperation({
    summary: 'Create a new escrow transaction',
    description:
      'Creates a new escrow in CREATED state with a payment URL for the buyer. The escrow transitions to FUNDED when the buyer completes the on-chain payment.',
  })
  @ApiCreatedResponse({
    description: 'Escrow created successfully.',
    type: EscrowWithPaymentUrlResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — duplicate item reference.',
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
  @ApiBearerAuth()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  createEscrow(
    @Body() dto: CreateEscrowDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key header is required and must be a valid UUID',
      );
    }
    return this.escrowService.createIdempotent(
      idempotencyKey,
      dto,
      user.address,
    );
  }

  /**
   * Generates a pre-signed S3 upload URL for evidence files.
   *
   * @param fileName - Original filename for the upload
   * @param user - Authenticated user requesting the upload URL
   * @returns Upload URL, public URL, and expiration details
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT
   * @rateLimit evidence-upload throttler (default 10 per 60 seconds)
   */
  @ApiOperation({
    summary: 'Generate a pre-signed URL for evidence file upload',
  })
  @ApiQuery({
    name: 'fileName',
    description: 'Original file name for the evidence being uploaded.',
    example: 'damage-photo.jpg',
  })
  @ApiCreatedResponse({
    description: 'Pre-signed upload URL generated.',
    type: EvidenceUploadResponseDto,
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
  @ApiBearerAuth()
  @Post('evidence-upload')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ default: EVIDENCE_UPLOAD_THROTTLE })
  evidenceUpload(
    @Query('fileName') fileName: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.generateEvidenceUploadUrl(user.address, fileName);
  }

  /**
   * Returns the public projection of an escrow by ID.
   * Sensitive fields (addresses, contact info) are excluded.
   *
   * @param id - UUID of the escrow to retrieve
   * @returns Public escrow data without internal identifiers
   * @throws NotFoundException if escrow does not exist
   */
  @ApiOperation({ summary: 'Get public escrow details by ID' })
  @ApiOkResponse({
    description: 'Escrow details returned.',
    type: EscrowResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
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
  @Get(':id')
  getEscrow(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getPublicEscrow(id);
  }

  /**
   * Returns chronological event history for an escrow.
   * Events include CREATED, SHIPPED, DELIVERED, CANCELLED, FUNDED, DISPUTED,
   * COMPLETED, RELEASED and REFUNDED, read from the EscrowEvent audit table.
   *
   * @param id - UUID of the escrow
   * @returns Array of event objects with event name, timestamp, fromState and toState
   */
  @ApiOperation({ summary: 'Get all events for an escrow transaction' })
  @ApiOkResponse({
    description: 'List of escrow events returned.',
    type: [EscrowEventEntryDto],
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
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
  @Get(':id/events')
  @Throttle({ public: { limit: 100, ttl: THROTTLE_WINDOW_MS } })
  getEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getEvents(id);
  }

  /**
   * Returns shipment tracking status for an escrow.
   * Results are cached for 60 seconds.
   *
   * @param id - UUID of the escrow
   * @returns Tracking status with events, estimated delivery, and carrier info
   * @throws NotFoundException if tracking info is not available or escrow not found
   */
  @ApiOperation({
    summary: 'Get carrier tracking information for an escrow shipment',
  })
  @ApiOkResponse({
    description: 'Tracking information returned.',
    type: TrackingResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found or not yet shipped.',
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
  @Get(':id/tracking')
  async getTracking(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getTracking(id);
  }

  // ── Issue #28 ─────────────────────────────────────────────────────────────
  // No JwtGuard: the buyer is not authenticated via SEP-10 at payment time.
  // The endpoint is intentionally unauthenticated — the escrow ID in the URL
  // acts as the possession proof (it was shared with the buyer by the vendor).
  // Rate-limited tightly to prevent enumeration.
  /**
   * Stores encrypted buyer contact information on the escrow.
   * This endpoint is intentionally unauthenticated — the escrow ID
   * serves as the possession proof. At least one of email or phone
   * must be provided.
   *
   * @param id - UUID of the escrow
   * @param dto - Buyer contact details (email and/or phone)
   * @returns Acknowledgement message
   * @throws NotFoundException if escrow does not exist
   * @throws ConflictException if escrow is in a terminal state
   * @authentication None (unauthenticated endpoint)
   * @rateLimit 10 requests per 60 seconds
   */
  @ApiOperation({ summary: 'Update buyer contact details for an escrow' })
  @ApiOkResponse({
    description: 'Buyer contact updated.',
    type: BuyerContactUpdateResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — escrow is in a terminal state.',
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
  @Patch(':id/buyer-contact')
  @HttpCode(HttpStatus.OK)
  @Throttle({ public: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  updateBuyerContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyerContactDto,
  ) {
    return this.escrowService.updateBuyerContact(id, dto);
  }

  /**
   * Marks a funded escrow as shipped with a carrier tracking ID.
   * Only the vendor who created the escrow can ship it.
   *
   * @param id - UUID of the escrow
   * @param dto - Shipment details containing the tracking ID
   * @param user - Authenticated vendor making the request
   * @returns Updated escrow record with SHIPPED state
   * @throws ForbiddenException if caller is not the escrow vendor
   * @throws ConflictException if escrow is not in FUNDED state
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   * @rateLimit 20 requests per 60 seconds
   */
  @ApiOperation({ summary: 'Mark an escrow as shipped with a tracking ID' })
  @ApiOkResponse({
    description: 'Escrow marked as shipped.',
    type: EscrowResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — not the escrow vendor.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — escrow is not in FUNDED state.',
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
  @ApiBearerAuth()
  @Patch(':id/ship')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  shipEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShipmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.handleShipment(
      id,
      user.address,
      dto.trackingId,
      user.role === 'admin',
    );
  }

  /**
   * Cancel a FUNDED escrow. Only the buyer, vendor, or admin may call this endpoint.
   *
   * Precondition: escrow must be in FUNDED state.
   * Transitions escrow to CANCELLED state.
   * See DELETE /escrow/:id for cancelling a CREATED (pending) escrow.
   *
   * @param id - UUID of the escrow to cancel
   * @param user - Authenticated caller (buyer or vendor)
   * @returns Updated escrow record with CANCELLED state
   * @throws ForbiddenException if caller is not the buyer or vendor
   * @throws ConflictException if escrow is not in FUNDED state
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (buyer or vendor)
   * @rateLimit 10 requests per 60 seconds
   */
  @ApiOperation({
    summary: 'Cancel a FUNDED escrow transaction',
    description:
      'Cancels a FUNDED escrow, transitioning it to CANCELLED state. Precondition: escrow must be in FUNDED state. Only the buyer, vendor, or admin can cancel. See DELETE /escrow/:id for cancelling a CREATED (pending) escrow.',
  })
  @ApiOkResponse({
    description: 'Escrow cancelled.',
    type: EscrowResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — not the escrow vendor or buyer.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — escrow is not in FUNDED state.',
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
  @ApiBearerAuth()
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  cancelEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.cancelEscrow(
      id,
      user.address,
      user.role === 'admin',
    );
  }

  /**
   * Cancel a CREATED (pending) escrow with on-chain state verification.
   * Only the buyer, vendor, or admin may call this endpoint.
   *
   * Precondition: escrow must be in CREATED state (not yet funded).
   * If the escrow has been funded on-chain, a refund is submitted before cancellation.
   * Transitions escrow to CANCELLED state.
   * See PATCH /escrow/:id/cancel for cancelling a FUNDED escrow.
   *
   * @param id - UUID of the escrow to cancel
   * @param user - Authenticated caller (buyer or vendor)
   * @returns Updated escrow record with CANCELLED state
   * @throws ForbiddenException if caller is not the buyer or vendor
   * @throws ConflictException if escrow is not in CREATED state
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (buyer or vendor)
   * @rateLimit 10 requests per 60 seconds
   */
  @ApiOperation({
    summary: 'Cancel a CREATED (pending) escrow transaction',
    description:
      'Cancels a CREATED (pending) escrow, with on-chain state verification. If funded on-chain, a refund is submitted before cancellation. Precondition: escrow must be in CREATED state. Only the buyer, vendor, or admin can cancel. See PATCH /escrow/:id/cancel for cancelling a FUNDED escrow.',
  })
  @ApiOkResponse({
    description: 'Pending escrow deleted.',
    type: EscrowResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — not the escrow vendor or buyer.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — escrow is not in CREATED state.',
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
  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  cancelPendingEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.escrowService.cancelPendingEscrow(
      id,
      user.address,
      user.role === 'admin',
    );
  }

  /**
   * Opens a dispute against an escrow. The buyer provides a reason
   * category, detailed description, and optional evidence URLs.
   *
   * @param id - UUID of the escrow to dispute
   * @param dto - Dispute details (reason, description, evidence URLs)
   * @param user - Authenticated buyer making the request
   * @returns Created dispute record
   * @throws ForbiddenException if caller is not the buyer
   * @throws ConflictException if escrow is in a terminal state
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (buyer)
   * @rateLimit 5 requests per 60 seconds
   */
  @ApiOperation({ summary: 'Open a dispute for an escrow transaction' })
  @ApiCreatedResponse({
    description: 'Dispute opened successfully.',
    type: DisputeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — caller is not the buyer.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Escrow not found.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — escrow is in a terminal state.',
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
  @ApiBearerAuth()
  @Post(':id/dispute')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 5, ttl: THROTTLE_WINDOW_MS } })
  openDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDisputeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.buyerDisputeService.openDispute(id, user.address, dto);
  }

  /**
   * Returns the dispute details for an escrow if one exists.
   *
   * @param id - UUID of the escrow
   * @param user - Authenticated caller
   * @returns Dispute record or not-found error
   * @throws NotFoundException if no dispute exists for this escrow
   * @throws ForbiddenException if caller is not the buyer or vendor
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT
   * @rateLimit 30 requests per 60 seconds
   */
  @ApiOperation({ summary: 'Get the dispute record for an escrow transaction' })
  @ApiOkResponse({
    description: 'Dispute details returned.',
    type: DisputeResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — caller is not the buyer or vendor.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Dispute not found.',
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
  @ApiBearerAuth()
  @Get(':id/dispute')
  @UseGuards(JwtGuard)
  @Throttle({ public: { limit: 30, ttl: THROTTLE_WINDOW_MS } })
  getDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.buyerDisputeService.getDispute(id, user.address);
  }
}
