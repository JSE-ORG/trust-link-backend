import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '../../src/config/config.service';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';

describe('Escrow Cancel Endpoints (issue #516)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAddress: string;

  const vendorAddress =
    'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
  const buyerAddress =
    'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';
  const strangerAddress =
    'GDTM7BUWHKUNZQVC3TA2O3NESSWCD26CHH6ORQLB4JCO6JXF4L3EUVCL';

  const createdEscrowId = '00000000-0000-4000-8000-000000000001';
  const fundedEscrowId = '00000000-0000-4000-8000-000000000002';
  const shippedEscrowId = '00000000-0000-4000-8000-000000000003';

  const adminAuth = (): string => bearer(adminAddress, { role: 'admin' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    adminAddress = app.get(ConfigService).get<string>('ADMIN_ADDRESS')!;
  });

  beforeEach(async () => {
    await prisma.reset();

    // Create a CREATED (pending) escrow
    await prisma.escrow.create({
      data: {
        id: createdEscrowId,
        itemName: 'Pending Item',
        itemRef: 'PENDING-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'CREATED',
      },
    });

    // Create a FUNDED escrow
    await prisma.escrow.create({
      data: {
        id: fundedEscrowId,
        itemName: 'Funded Item',
        itemRef: 'FUNDED-001',
        amount: 200,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'FUNDED',
      },
    });

    // Create a SHIPPED escrow (should not be cancellable by either endpoint)
    await prisma.escrow.create({
      data: {
        id: shippedEscrowId,
        itemName: 'Shipped Item',
        itemRef: 'SHIPPED-001',
        amount: 300,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'SHIPPED',
        trackingId: 'TRK-12345',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /escrow - Creation state verification', () => {
    it('should create escrow in CREATED state (not FUNDED)', async () => {
      const createDto = {
        itemName: 'Test Item',
        itemRef: 'TEST-001',
        amount: 150,
        currency: 'USDC',
        buyerAddress: 'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2',
      };

      const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';

      const res = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', bearer(vendorAddress))
        .set('Idempotency-Key', idempotencyKey)
        .send(createDto)
        .expect(201);

      // Verify escrow was created with payment URL
      expect(res.body).toHaveProperty('paymentUrl');
      expect(res.body.paymentUrl).toContain('trust-link.local/pay/');

      // Verify the state is CREATED, not FUNDED
      expect(res.body.state).toBe('CREATED');
    });
  });

  describe('PATCH /escrow/:id/cancel - FUNDED escrow cancellation', () => {
    it('should cancel a FUNDED escrow when called by vendor', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/escrow/${fundedEscrowId}/cancel`)
        .set('Authorization', bearer(vendorAddress))
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');

      // Verify persisted state
      const updated = await prisma.escrow.findUnique({
        where: { id: fundedEscrowId },
      });
      expect(updated?.state).toBe('CANCELLED');
    });

    it('should cancel a FUNDED escrow when called by buyer', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/escrow/${fundedEscrowId}/cancel`)
        .set('Authorization', bearer(buyerAddress))
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('should cancel a FUNDED escrow when called by admin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/escrow/${fundedEscrowId}/cancel`)
        .set('Authorization', adminAuth())
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('should return 403 when stranger tries to cancel FUNDED escrow', async () => {
      await request(app.getHttpServer())
        .patch(`/escrow/${fundedEscrowId}/cancel`)
        .set('Authorization', bearer(strangerAddress))
        .expect(403);
    });

    it('should return 409 when PATCH /cancel called on CREATED (not FUNDED) escrow', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/escrow/${createdEscrowId}/cancel`)
        .set('Authorization', bearer(vendorAddress))
        .expect(409);

      expect(res.body.message).toContain('CREATED');
      expect(res.body.message).toContain('FUNDED');
    });

    it('should return 409 when PATCH /cancel called on SHIPPED escrow', async () => {
      await request(app.getHttpServer())
        .patch(`/escrow/${shippedEscrowId}/cancel`)
        .set('Authorization', bearer(vendorAddress))
        .expect(409);
    });

    it('should return 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .patch(`/escrow/${fundedEscrowId}/cancel`)
        .expect(401);
    });
  });

  describe('DELETE /escrow/:id - CREATED escrow cancellation', () => {
    it('should cancel a CREATED escrow when called by vendor', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/escrow/${createdEscrowId}`)
        .set('Authorization', bearer(vendorAddress))
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');

      // Verify persisted state
      const updated = await prisma.escrow.findUnique({
        where: { id: createdEscrowId },
      });
      expect(updated?.state).toBe('CANCELLED');
    });

    it('should cancel a CREATED escrow when called by buyer', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/escrow/${createdEscrowId}`)
        .set('Authorization', bearer(buyerAddress))
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('should cancel a CREATED escrow when called by admin', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/escrow/${createdEscrowId}`)
        .set('Authorization', adminAuth())
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('should return 403 when stranger tries to cancel CREATED escrow', async () => {
      await request(app.getHttpServer())
        .delete(`/escrow/${createdEscrowId}`)
        .set('Authorization', bearer(strangerAddress))
        .expect(403);
    });

    it('should return 409 when DELETE called on FUNDED (not CREATED) escrow', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/escrow/${fundedEscrowId}`)
        .set('Authorization', bearer(vendorAddress))
        .expect(409);

      expect(res.body.message).toContain('CREATED');
      expect(res.body.message).toContain('FUNDED');
    });

    it('should return 409 when DELETE called on SHIPPED escrow', async () => {
      await request(app.getHttpServer())
        .delete(`/escrow/${shippedEscrowId}`)
        .set('Authorization', bearer(vendorAddress))
        .expect(409);
    });

    it('should return 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .delete(`/escrow/${createdEscrowId}`)
        .expect(401);
    });
  });

  describe('Endpoint differentiation', () => {
    it('PATCH /cancel and DELETE are different routes with different preconditions', async () => {
      // PATCH /cancel works on FUNDED
      await request(app.getHttpServer())
        .patch(`/escrow/${fundedEscrowId}/cancel`)
        .set('Authorization', bearer(vendorAddress))
        .expect(200);

      // DELETE works on CREATED (not FUNDED)
      await request(app.getHttpServer())
        .delete(`/escrow/${createdEscrowId}`)
        .set('Authorization', bearer(vendorAddress))
        .expect(200);
    });

    it('PATCH /cancel rejects CREATED escrows', async () => {
      await request(app.getHttpServer())
        .patch(`/escrow/${createdEscrowId}/cancel`)
        .set('Authorization', bearer(vendorAddress))
        .expect(409);
    });

    it('DELETE rejects FUNDED escrows', async () => {
      await request(app.getHttpServer())
        .delete(`/escrow/${fundedEscrowId}`)
        .set('Authorization', bearer(vendorAddress))
        .expect(409);
    });
  });
});
