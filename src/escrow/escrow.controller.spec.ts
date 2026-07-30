import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { bearer } from '../../test/auth-helper';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { BuyerDisputeService } from './buyer-dispute.service';
import { DisputeReasonCategory } from './dto/open-dispute.dto';
import { EscrowController } from './escrow.controller';
import { EscrowService } from './escrow.service';

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_IDEMPOTENCY_KEY = '987e6543-e21b-12d3-a456-426614174999';
const VENDOR_ADDRESS =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const BUYER_ADDRESS =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const AUTH_VENDOR = bearer(VENDOR_ADDRESS);
const AUTH_BUYER = bearer(BUYER_ADDRESS);

describe('EscrowController', () => {
  let app: INestApplication;
  let escrowService: jest.Mocked<EscrowService>;
  let buyerDisputeService: jest.Mocked<BuyerDisputeService>;

  beforeEach(async () => {
    escrowService = {
      createIdempotent: jest.fn(),
      generateEvidenceUploadUrl: jest.fn(),
      getPublicEscrow: jest.fn(),
      getEvents: jest.fn(),
      getTracking: jest.fn(),
      updateBuyerContact: jest.fn(),
      handleShipment: jest.fn(),
      cancelEscrow: jest.fn(),
      cancelPendingEscrow: jest.fn(),
    } as unknown as jest.Mocked<EscrowService>;

    buyerDisputeService = {
      openDispute: jest.fn(),
      getDispute: jest.fn(),
    } as unknown as jest.Mocked<BuyerDisputeService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        JwtGuard,
        { provide: EscrowService, useValue: escrowService },
        { provide: BuyerDisputeService, useValue: buyerDisputeService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. POST /escrow (createEscrow)
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /escrow', () => {
    const validDto = {
      itemName: 'Sony Camera A7',
      itemRef: 'SKU-CAM-001',
      amount: 1500,
      currency: 'USDC',
      buyerAddress: BUYER_ADDRESS,
    };

    it('returns 400 when Idempotency-Key header is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', AUTH_VENDOR)
        .send(validDto)
        .expect(400);

      expect(res.body.message).toContain(
        'Idempotency-Key header is required and must be a valid UUID',
      );
    });

    it('returns 400 when Idempotency-Key header is not a valid UUID', async () => {
      const res = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', AUTH_VENDOR)
        .set('Idempotency-Key', 'not-a-uuid')
        .send(validDto)
        .expect(400);

      expect(res.body.message).toContain(
        'Idempotency-Key header is required and must be a valid UUID',
      );
    });

    it('returns 400 when body contains an unknown property (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', AUTH_VENDOR)
        .set('Idempotency-Key', VALID_IDEMPOTENCY_KEY)
        .send({
          ...validDto,
          unknownField: 'disallowed',
        })
        .expect(400);

      expect(res.body.message).toContain(
        'property unknownField should not exist',
      );
    });

    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .post('/escrow')
        .set('Idempotency-Key', VALID_IDEMPOTENCY_KEY)
        .send(validDto)
        .expect(401);
    });

    it('returns 201 and creates escrow on valid request', async () => {
      const mockResult = {
        id: VALID_UUID,
        itemName: validDto.itemName,
        paymentUrl: 'https://pay.example.com/escrow/123',
      };
      escrowService.createIdempotent.mockResolvedValue(mockResult as never);

      const res = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', AUTH_VENDOR)
        .set('Idempotency-Key', VALID_IDEMPOTENCY_KEY)
        .send(validDto)
        .expect(201);

      expect(escrowService.createIdempotent).toHaveBeenCalledWith(
        VALID_IDEMPOTENCY_KEY,
        expect.objectContaining({ itemName: validDto.itemName }),
        VENDOR_ADDRESS,
      );
      expect(res.body).toEqual(mockResult);
    });

    it('returns 409 when service throws ConflictException', async () => {
      escrowService.createIdempotent.mockRejectedValue(
        new ConflictException('Duplicate item reference'),
      );

      await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', AUTH_VENDOR)
        .set('Idempotency-Key', VALID_IDEMPOTENCY_KEY)
        .send(validDto)
        .expect(409);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. POST /escrow/evidence-upload (evidenceUpload)
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /escrow/evidence-upload', () => {
    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .post('/escrow/evidence-upload?fileName=damage.jpg')
        .expect(401);
    });

    it('returns 201 on valid request', async () => {
      const mockUploadResponse = {
        uploadUrl: 'https://s3.amazonaws.com/bucket/damage.jpg',
        publicUrl: 'https://cdn.example.com/damage.jpg',
        expiresAt: '2026-07-29T16:00:00.000Z',
      };
      escrowService.generateEvidenceUploadUrl.mockResolvedValue(
        mockUploadResponse as never,
      );

      const res = await request(app.getHttpServer())
        .post('/escrow/evidence-upload?fileName=damage.jpg')
        .set('Authorization', AUTH_VENDOR)
        .expect(201);

      expect(escrowService.generateEvidenceUploadUrl).toHaveBeenCalledWith(
        VENDOR_ADDRESS,
        'damage.jpg',
      );
      expect(res.body).toEqual(mockUploadResponse);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. GET /escrow/:id (getEscrow)
  // ───────────────────────────────────────────────────────────────────────────

  describe('GET /escrow/:id', () => {
    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .get('/escrow/invalid-uuid-123')
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 404 when escrow is not found', async () => {
      escrowService.getPublicEscrow.mockRejectedValue(
        new NotFoundException('Escrow not found'),
      );

      await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}`)
        .expect(404);
    });

    it('returns 200 and public escrow details', async () => {
      const mockPublicEscrow = {
        id: VALID_UUID,
        itemName: 'Sony Camera A7',
        amount: 1500,
        currency: 'USDC',
        status: 'FUNDED',
      };
      escrowService.getPublicEscrow.mockResolvedValue(
        mockPublicEscrow as never,
      );

      const res = await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}`)
        .expect(200);

      expect(escrowService.getPublicEscrow).toHaveBeenCalledWith(VALID_UUID);
      expect(res.body).toEqual(mockPublicEscrow);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. GET /escrow/:id/events (getEvents)
  // ───────────────────────────────────────────────────────────────────────────

  describe('GET /escrow/:id/events', () => {
    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .get('/escrow/not-a-uuid/events')
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 404 when escrow is not found', async () => {
      escrowService.getEvents.mockRejectedValue(
        new NotFoundException('Escrow not found'),
      );

      await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/events`)
        .expect(404);
    });

    it('returns 200 and event list', async () => {
      const mockEvents = [
        { eventName: 'CREATED', timestamp: '2026-07-29T10:00:00.000Z' },
        { eventName: 'FUNDED', timestamp: '2026-07-29T10:05:00.000Z' },
      ];
      escrowService.getEvents.mockResolvedValue(mockEvents as never);

      const res = await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/events`)
        .expect(200);

      expect(escrowService.getEvents).toHaveBeenCalledWith(VALID_UUID);
      expect(res.body).toEqual(mockEvents);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. GET /escrow/:id/tracking (getTracking)
  // ───────────────────────────────────────────────────────────────────────────

  describe('GET /escrow/:id/tracking', () => {
    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .get('/escrow/bad-id/tracking')
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 404 when tracking is not found', async () => {
      escrowService.getTracking.mockRejectedValue(
        new NotFoundException('Tracking info not available'),
      );

      await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/tracking`)
        .expect(404);
    });

    it('returns 200 and tracking details', async () => {
      const mockTracking = {
        trackingId: 'TRK-1Z999AA10123456784',
        status: 'IN_TRANSIT',
        carrier: 'DHL',
      };
      escrowService.getTracking.mockResolvedValue(mockTracking as never);

      const res = await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/tracking`)
        .expect(200);

      expect(escrowService.getTracking).toHaveBeenCalledWith(VALID_UUID);
      expect(res.body).toEqual(mockTracking);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. PATCH /escrow/:id/buyer-contact (updateBuyerContact)
  // ───────────────────────────────────────────────────────────────────────────

  describe('PATCH /escrow/:id/buyer-contact', () => {
    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/escrow/invalid-uuid/buyer-contact')
        .send({ email: 'buyer@example.com' })
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 400 when body contains non-whitelisted property', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/buyer-contact`)
        .send({ email: 'buyer@example.com', extraAttr: 'disallowed' })
        .expect(400);

      expect(res.body.message).toContain('property extraAttr should not exist');
    });

    it('returns 409 when escrow is in terminal state', async () => {
      escrowService.updateBuyerContact.mockRejectedValue(
        new ConflictException('Escrow is in a terminal state'),
      );

      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/buyer-contact`)
        .send({ email: 'buyer@example.com' })
        .expect(409);
    });

    it('returns 200 on success', async () => {
      const mockResponse = { message: 'Buyer contact details updated' };
      escrowService.updateBuyerContact.mockResolvedValue(mockResponse);

      const res = await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/buyer-contact`)
        .send({ email: 'buyer@example.com' })
        .expect(200);

      expect(escrowService.updateBuyerContact).toHaveBeenCalledWith(
        VALID_UUID,
        expect.objectContaining({ email: 'buyer@example.com' }),
      );
      expect(res.body).toEqual(mockResponse);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. PATCH /escrow/:id/ship (shipEscrow)
  // ───────────────────────────────────────────────────────────────────────────

  describe('PATCH /escrow/:id/ship', () => {
    const validShipDto = { trackingId: 'TRK-9876543210' };

    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/ship`)
        .send(validShipDto)
        .expect(401);
    });

    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/escrow/not-a-uuid/ship')
        .set('Authorization', AUTH_VENDOR)
        .send(validShipDto)
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 400 when body contains non-whitelisted property', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/ship`)
        .set('Authorization', AUTH_VENDOR)
        .send({ ...validShipDto, extraProp: 'forbidden' })
        .expect(400);

      expect(res.body.message).toContain('property extraProp should not exist');
    });

    it('returns 403 when caller is not the escrow vendor', async () => {
      escrowService.handleShipment.mockRejectedValue(
        new ForbiddenException('Not the escrow vendor'),
      );

      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/ship`)
        .set('Authorization', AUTH_VENDOR)
        .send(validShipDto)
        .expect(403);
    });

    it('returns 409 when escrow is not in FUNDED state', async () => {
      escrowService.handleShipment.mockRejectedValue(
        new ConflictException('Escrow is not in FUNDED state'),
      );

      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/ship`)
        .set('Authorization', AUTH_VENDOR)
        .send(validShipDto)
        .expect(409);
    });

    it('returns 200 on success', async () => {
      const mockResult = { id: VALID_UUID, status: 'SHIPPED' };
      escrowService.handleShipment.mockResolvedValue(mockResult as never);

      const res = await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/ship`)
        .set('Authorization', AUTH_VENDOR)
        .send(validShipDto)
        .expect(200);

      expect(escrowService.handleShipment).toHaveBeenCalledWith(
        VALID_UUID,
        VENDOR_ADDRESS,
        validShipDto.trackingId,
        false,
      );
      expect(res.body).toEqual(mockResult);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. PATCH /escrow/:id/cancel (cancelEscrow)
  // ───────────────────────────────────────────────────────────────────────────

  describe('PATCH /escrow/:id/cancel', () => {
    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/cancel`)
        .expect(401);
    });

    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/escrow/bad-uuid/cancel')
        .set('Authorization', AUTH_VENDOR)
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 403 when caller is forbidden', async () => {
      escrowService.cancelEscrow.mockRejectedValue(
        new ForbiddenException('Forbidden'),
      );

      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/cancel`)
        .set('Authorization', AUTH_VENDOR)
        .expect(403);
    });

    it('returns 409 when escrow is not in FUNDED state', async () => {
      escrowService.cancelEscrow.mockRejectedValue(
        new ConflictException('Escrow not in FUNDED state'),
      );

      await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/cancel`)
        .set('Authorization', AUTH_VENDOR)
        .expect(409);
    });

    it('returns 200 on success', async () => {
      const mockResult = { id: VALID_UUID, status: 'CANCELLED' };
      escrowService.cancelEscrow.mockResolvedValue(mockResult as never);

      const res = await request(app.getHttpServer())
        .patch(`/escrow/${VALID_UUID}/cancel`)
        .set('Authorization', AUTH_VENDOR)
        .expect(200);

      expect(escrowService.cancelEscrow).toHaveBeenCalledWith(
        VALID_UUID,
        VENDOR_ADDRESS,
        false,
      );
      expect(res.body).toEqual(mockResult);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. DELETE /escrow/:id (cancelPendingEscrow)
  // ───────────────────────────────────────────────────────────────────────────

  describe('DELETE /escrow/:id', () => {
    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .delete(`/escrow/${VALID_UUID}`)
        .expect(401);
    });

    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .delete('/escrow/malformed-uuid')
        .set('Authorization', AUTH_VENDOR)
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 403 when caller is forbidden', async () => {
      escrowService.cancelPendingEscrow.mockRejectedValue(
        new ForbiddenException('Forbidden'),
      );

      await request(app.getHttpServer())
        .delete(`/escrow/${VALID_UUID}`)
        .set('Authorization', AUTH_VENDOR)
        .expect(403);
    });

    it('returns 409 when escrow is not in CREATED state', async () => {
      escrowService.cancelPendingEscrow.mockRejectedValue(
        new ConflictException('Escrow is not in CREATED state'),
      );

      await request(app.getHttpServer())
        .delete(`/escrow/${VALID_UUID}`)
        .set('Authorization', AUTH_VENDOR)
        .expect(409);
    });

    it('returns 200 on success', async () => {
      const mockResult = { id: VALID_UUID, status: 'CANCELLED' };
      escrowService.cancelPendingEscrow.mockResolvedValue(mockResult as never);

      const res = await request(app.getHttpServer())
        .delete(`/escrow/${VALID_UUID}`)
        .set('Authorization', AUTH_VENDOR)
        .expect(200);

      expect(escrowService.cancelPendingEscrow).toHaveBeenCalledWith(
        VALID_UUID,
        VENDOR_ADDRESS,
        false,
      );
      expect(res.body).toEqual(mockResult);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. POST /escrow/:id/dispute (openDispute)
  // ───────────────────────────────────────────────────────────────────────────

  describe('POST /escrow/:id/dispute', () => {
    const validDisputeDto = {
      reason: DisputeReasonCategory.ITEM_NOT_RECEIVED,
      description: 'The package was never delivered to the shipping address.',
    };

    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .post(`/escrow/${VALID_UUID}/dispute`)
        .send(validDisputeDto)
        .expect(401);
    });

    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .post('/escrow/not-a-valid-uuid/dispute')
        .set('Authorization', AUTH_BUYER)
        .send(validDisputeDto)
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 400 when body contains non-whitelisted property', async () => {
      const res = await request(app.getHttpServer())
        .post(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .send({ ...validDisputeDto, fakeField: 'disallowed' })
        .expect(400);

      expect(res.body.message).toContain('property fakeField should not exist');
    });

    it('returns 403 when caller is not the buyer', async () => {
      buyerDisputeService.openDispute.mockRejectedValue(
        new ForbiddenException('Only the buyer can open a dispute'),
      );

      await request(app.getHttpServer())
        .post(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .send(validDisputeDto)
        .expect(403);
    });

    it('returns 409 when escrow is in terminal state', async () => {
      buyerDisputeService.openDispute.mockRejectedValue(
        new ConflictException('Escrow in terminal state'),
      );

      await request(app.getHttpServer())
        .post(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .send(validDisputeDto)
        .expect(409);
    });

    it('returns 201 on success', async () => {
      const mockDispute = {
        id: 'dispute-001',
        escrowId: VALID_UUID,
        reason: validDisputeDto.reason,
        description: validDisputeDto.description,
      };
      buyerDisputeService.openDispute.mockResolvedValue(mockDispute as never);

      const res = await request(app.getHttpServer())
        .post(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .send(validDisputeDto)
        .expect(201);

      expect(buyerDisputeService.openDispute).toHaveBeenCalledWith(
        VALID_UUID,
        BUYER_ADDRESS,
        expect.objectContaining({ reason: validDisputeDto.reason }),
      );
      expect(res.body).toEqual(mockDispute);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. GET /escrow/:id/dispute (getDispute)
  // ───────────────────────────────────────────────────────────────────────────

  describe('GET /escrow/:id/dispute', () => {
    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/dispute`)
        .expect(401);
    });

    it('returns 400 when id is not a valid UUID (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .get('/escrow/invalid-uuid-str/dispute')
        .set('Authorization', AUTH_BUYER)
        .expect(400);

      expect(res.body.message).toContain(
        'Validation failed (uuid is expected)',
      );
    });

    it('returns 403 when caller is not buyer or vendor', async () => {
      buyerDisputeService.getDispute.mockRejectedValue(
        new ForbiddenException('Forbidden'),
      );

      await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .expect(403);
    });

    it('returns 404 when dispute is not found', async () => {
      buyerDisputeService.getDispute.mockRejectedValue(
        new NotFoundException('Dispute not found'),
      );

      await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .expect(404);
    });

    it('returns 200 on success', async () => {
      const mockDispute = {
        id: 'dispute-001',
        escrowId: VALID_UUID,
        reason: 'ITEM_NOT_RECEIVED',
      };
      buyerDisputeService.getDispute.mockResolvedValue(mockDispute as never);

      const res = await request(app.getHttpServer())
        .get(`/escrow/${VALID_UUID}/dispute`)
        .set('Authorization', AUTH_BUYER)
        .expect(200);

      expect(buyerDisputeService.getDispute).toHaveBeenCalledWith(
        VALID_UUID,
        BUYER_ADDRESS,
      );
      expect(res.body).toEqual(mockDispute);
    });
  });
});
