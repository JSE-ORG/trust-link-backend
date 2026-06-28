import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';

const VENDOR_ADDRESS =
  'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER_ADDRESS =
  'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';
const UNRELATED_ADDRESS =
  'GCLKIIQCXY62273JIOSH4BKI5LP2W2FTMLSPNACTM2NAIVYXHSREUQSQ';

describe('Escrow Cancellation with On-Chain Validation (issue #298)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contractService: ContractService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
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
      .mockResolvedValue('tx-hash-cancel-test');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  async function createEscrow(overrides?: Partial<{ state: string }>) {
    const res = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
      .send({
        itemName: 'Test Item',
        itemRef: `cancel-test-${Date.now()}`,
        amount: 150,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    if (overrides?.state && overrides.state !== 'FUNDED') {
      await prisma.escrow.update({
        where: { id: res.body.id },
        data: { state: overrides.state as any },
      });
    }

    return res.body;
  }

  describe('DELETE /escrow/:id (cancel pending)', () => {
    it('cancels a pending escrow in CREATED state', async () => {
      const escrow = await createEscrow({ state: 'CREATED' });

      const res = await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
      expect(res.body.cancelledAt).toBeDefined();

      const fromDb = await prisma.escrow.findUnique({
        where: { id: escrow.id },
      });
      expect(fromDb?.state).toBe('CANCELLED');
    });

    it('cancels a funded escrow via cancel endpoint', async () => {
      const escrow = await createEscrow();

      const res = await request(app.getHttpServer())
        .patch(`/escrow/${escrow.id}/cancel`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('returns 409 when cancelling an already-shipped escrow', async () => {
      const escrow = await createEscrow();

      await request(app.getHttpServer())
        .patch(`/escrow/${escrow.id}/ship`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({ trackingId: 'TRK-SHIP-001' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(409);
    });

    it('returns 404 for a non-existent escrow', async () => {
      await request(app.getHttpServer())
        .delete('/escrow/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .expect(404);
    });

    it('returns 403 for unauthorized cancellation attempt', async () => {
      const escrow = await createEscrow();

      await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .set('Authorization', `Bearer ${UNRELATED_ADDRESS}`)
        .expect(403);
    });

    it('allows buyer to cancel a pending escrow', async () => {
      const escrow = await createEscrow({ state: 'CREATED' });

      const res = await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .expect(200);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('returns 401 for unauthenticated requests', async () => {
      const escrow = await createEscrow({ state: 'CREATED' });

      await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .expect(401);
    });
  });
});
