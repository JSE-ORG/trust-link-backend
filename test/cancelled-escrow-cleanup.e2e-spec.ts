/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContractService } from '../src/stellar/contract.service';

const VENDOR_ADDRESS =
  'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER_ADDRESS =
  'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';
const UNAUTHORIZED_ADDRESS =
  'GDR23C4XFXVN74FHWJNFCYHJE3YBMHT4YCD5ZPKK3ZQ7Y3S4E76DVIYK';

describe('Cancelled escrow state cleanup E2E (issue #300)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contractService: ContractService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    contractService = app.get(ContractService);

    await prisma.reset();

    jest
      .spyOn(contractService, 'getEscrowState')
      .mockResolvedValue({ exists: false, state: 'CREATED' });
    jest
      .spyOn(contractService, 'cancelEscrowOnChain')
      .mockResolvedValue('tx-hash-cancel-001');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ── Cancel from CREATED state ────────────────────────────────────────────

  describe('Cancel from CREATED state (DELETE /escrow/:id)', () => {
    it('cancels a CREATED escrow and verifies CANCELLED state on GET', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Test Item For Cancel',
          itemRef: 'cancel-created-001',
          amount: 150,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await prisma.escrow.update({
        where: { id: escrowId },
        data: { state: 'CREATED' },
      });

      const cancelRes = await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .expect(200);

      expect(cancelRes.body.state).toBe('CANCELLED');
      expect(cancelRes.body.cancelledAt).toBeDefined();

      const getRes = await request(app.getHttpServer())
        .get(`/escrow/${escrowId}`)
        .expect(200);

      expect(getRes.body.state).toBe('CANCELLED');
    });

    it('records CANCELLED event in escrow event history after cancel from CREATED', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Test Item Events',
          itemRef: 'cancel-created-events-001',
          amount: 200,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await prisma.escrow.update({
        where: { id: escrowId },
        data: { state: 'CREATED' },
      });

      await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(200);

      const eventsRes = await request(app.getHttpServer())
        .get(`/escrow/${escrowId}/events`)
        .expect(200);

      const eventNames = eventsRes.body.map(
        (e: { event: string }) => e.event,
      );
      expect(eventNames).toContain('CREATED');
      expect(eventNames).toContain('CANCELLED');
    });

    it('allows vendor to cancel a CREATED escrow', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Vendor Cancel Test',
          itemRef: 'cancel-created-vendor-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await prisma.escrow.update({
        where: { id: escrowId },
        data: { state: 'CREATED' },
      });

      const cancelRes = await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(200);

      expect(cancelRes.body.state).toBe('CANCELLED');
    });
  });

  // ── Cancel from FUNDED state ─────────────────────────────────────────────

  describe('Cancel from FUNDED state (PATCH /escrow/:id/cancel)', () => {
    it('cancels a FUNDED escrow and verifies CANCELLED state on GET', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Test Item Funded Cancel',
          itemRef: 'cancel-funded-001',
          amount: 250,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;
      expect(createRes.body.state).toBe('FUNDED');

      const cancelRes = await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .expect(200);

      expect(cancelRes.body.state).toBe('CANCELLED');
      expect(cancelRes.body.cancelledAt).toBeDefined();

      const getRes = await request(app.getHttpServer())
        .get(`/escrow/${escrowId}`)
        .expect(200);

      expect(getRes.body.state).toBe('CANCELLED');
    });

    it('records CANCELLED event in escrow event history after cancel from FUNDED', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Test Item Funded Events',
          itemRef: 'cancel-funded-events-001',
          amount: 300,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(200);

      const eventsRes = await request(app.getHttpServer())
        .get(`/escrow/${escrowId}/events`)
        .expect(200);

      const eventNames = eventsRes.body.map(
        (e: { event: string }) => e.event,
      );
      expect(eventNames).toContain('CREATED');
      expect(eventNames).toContain('CANCELLED');
    });

    it('allows vendor to cancel a FUNDED escrow', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Vendor Funded Cancel',
          itemRef: 'cancel-funded-vendor-001',
          amount: 175,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      const cancelRes = await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(200);

      expect(cancelRes.body.state).toBe('CANCELLED');
    });
  });

  // ── Invalid cancellation attempts rejected ───────────────────────────────

  describe('Invalid cancellation attempts are rejected', () => {
    it('rejects cancel from CREATED state via PATCH (wrong endpoint)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Wrong Endpoint Cancel',
          itemRef: 'cancel-wrong-endpoint-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await prisma.escrow.update({
        where: { id: escrowId },
        data: { state: 'CREATED' },
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(409);
    });

    it('rejects cancel from FUNDED state via DELETE (wrong endpoint)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Wrong Endpoint Cancel Funded',
          itemRef: 'cancel-wrong-endpoint-funded-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(409);
    });

    it('rejects cancellation by unauthorized address', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Unauthorized Cancel',
          itemRef: 'cancel-unauthorized-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${UNAUTHORIZED_ADDRESS}`)
        .expect(403);
    });

    it('rejects cancellation without authentication', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'No Auth Cancel',
          itemRef: 'cancel-no-auth-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .expect(401);
    });

    it('rejects cancellation of an already cancelled escrow', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Double Cancel',
          itemRef: 'cancel-double-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .expect(409);
    });

    it('rejects cancellation of a SHIPPED escrow', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Shipped Cancel',
          itemRef: 'cancel-shipped-001',
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const escrowId: string = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/ship`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({ trackingId: 'TRK-SHIP-001' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .expect(409);
    });

    it('rejects cancellation of a non-existent escrow', async () => {
      await request(app.getHttpServer())
        .patch('/escrow/00000000-0000-0000-0000-000000000000/cancel')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(404);
    });
  });
});
