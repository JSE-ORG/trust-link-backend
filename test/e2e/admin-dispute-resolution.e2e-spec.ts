/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContractService } from '../src/stellar/contract.service';
import { NotificationsService } from '../src/notifications/notifications.service';

const VENDOR_ADDRESS =
  'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER_ADDRESS =
  'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';
const ADMIN_ADDRESS =
  'GDQTHTXOKWFZCT2T4U24YANOWEKGTTIPCBPAWL65YEIPCWCT3A2WNZEP';

describe('Admin Dispute Resolution Flow E2E (issue #299)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contractService: ContractService;
  let notificationsService: NotificationsService;

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
    notificationsService = app.get(NotificationsService);

    await prisma.reset();

    jest
      .spyOn(contractService, 'resolveDispute')
      .mockResolvedValue('tx-hash-dispute-resolved');
    jest
      .spyOn(notificationsService, 'notifyDisputed')
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(notificationsService, 'notifyDisputedAdmin')
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(notificationsService, 'notifyCompleted')
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(notificationsService, 'notifyRefunded')
      .mockResolvedValue(undefined as any);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  async function createEscrowAndDispute() {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
      .send({
        itemName: 'Dispute Resolution Test Item',
        itemRef: `dispute-res-${Date.now()}`,
        amount: 300,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    const escrowId = createRes.body.id;

    const disputeRes = await request(app.getHttpServer())
      .post(`/escrow/${escrowId}/dispute`)
      .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
      .send({
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description: 'Item quality does not match the listing description',
      })
      .expect(201);

    return { escrowId, disputeId: disputeRes.body.id };
  }

  describe('Dispute creation by buyer', () => {
    it('buyer can open a dispute on a funded escrow', async () => {
      const { escrowId, disputeId } = await createEscrowAndDispute();
      expect(disputeId).toBeDefined();

      const fromDb = await prisma.dispute.findUnique({
        where: { id: disputeId },
      });
      expect(fromDb?.escrowId).toBe(escrowId);
      expect(fromDb?.status).toBe('OPEN');
    });

    it('vendor can also open a dispute', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Vendor Dispute Item',
          itemRef: `vendor-dispute-${Date.now()}`,
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/escrow/${createRes.body.id}/dispute`)
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          reason: 'FRAUD',
          description: 'Buyer submitted fraudulent payment',
        })
        .expect(201);

      expect(res.body.status).toBe('OPEN');
    });

    it('prevents non-participants from opening disputes', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/escrow')
        .set('Authorization', `Bearer ${VENDOR_ADDRESS}`)
        .send({
          itemName: 'Unauthorized Dispute Item',
          itemRef: `unauth-dispute-${Date.now()}`,
          amount: 100,
          currency: 'USDC',
          buyerAddress: BUYER_ADDRESS,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/escrow/${createRes.body.id}/dispute`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({
          reason: 'FRAUD',
          description: 'Unauthorized dispute attempt',
        })
        .expect(403);
    });
  });

  describe('Admin dispute review', () => {
    it('admin can list all disputes', async () => {
      await createEscrowAndDispute();

      const res = await request(app.getHttpServer())
        .get('/admin/disputes')
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data).toBeDefined();
    });

    it('admin can filter disputes by status', async () => {
      await createEscrowAndDispute();

      const res = await request(app.getHttpServer())
        .get('/admin/disputes')
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .query({ status: 'OPEN' })
        .expect(200);

      expect(res.body.data.every((d: any) => d.status === 'OPEN')).toBe(true);
    });
  });

  describe('Admin resolve dispute — RELEASE funds to vendor', () => {
    it('admin resolves dispute by releasing funds', async () => {
      const { escrowId } = await createEscrowAndDispute();

      const res = await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'RELEASE' })
        .expect(200);

      expect(res.body.state).toBe('COMPLETED');
      expect(contractService.resolveDispute).toHaveBeenCalledWith(
        escrowId,
        'RELEASE',
      );

      const fromDb = await prisma.escrow.findUnique({
        where: { id: escrowId },
      });
      expect(fromDb?.state).toBe('COMPLETED');

      const disputeFromDb = await prisma.dispute.findFirst({
        where: { escrowId },
      });
      expect(disputeFromDb?.status).toBe('RESOLVED');
      expect(disputeFromDb?.resolvedAt).toBeTruthy();
    });
  });

  describe('Admin resolve dispute — REFUND to buyer', () => {
    it('admin resolves dispute by refunding to buyer', async () => {
      const { escrowId } = await createEscrowAndDispute();

      const res = await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'REFUND' })
        .expect(200);

      expect(res.body.state).toBe('REFUNDED');
      expect(contractService.resolveDispute).toHaveBeenCalledWith(
        escrowId,
        'REFUND',
      );

      const fromDb = await prisma.escrow.findUnique({
        where: { id: escrowId },
      });
      expect(fromDb?.state).toBe('REFUNDED');
    });
  });

  describe('Notifications after resolution', () => {
    it('sends notification to involved parties after RELEASE resolution', async () => {
      const { escrowId } = await createEscrowAndDispute();

      await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'RELEASE' })
        .expect(200);

      expect(notificationsService.notifyCompleted).toHaveBeenCalled();
    });

    it('sends notification to involved parties after REFUND resolution', async () => {
      const { escrowId } = await createEscrowAndDispute();

      await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'REFUND' })
        .expect(200);

      expect(notificationsService.notifyRefunded).toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    it('returns 404 when resolving a non-existent escrow dispute', async () => {
      await request(app.getHttpServer())
        .patch('/admin/dispute/00000000-0000-0000-0000-000000000000/resolve')
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'RELEASE' })
        .expect(404);
    });

    it('returns 409 when resolving an already-completed dispute', async () => {
      const { escrowId } = await createEscrowAndDispute();

      await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'RELEASE' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${ADMIN_ADDRESS}`)
        .send({ resolution: 'REFUND' })
        .expect(409);
    });

    it('returns 403 when non-admin tries to resolve a dispute', async () => {
      const { escrowId } = await createEscrowAndDispute();

      await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .set('Authorization', `Bearer ${BUYER_ADDRESS}`)
        .send({ resolution: 'RELEASE' })
        .expect(403);
    });

    it('returns 401 for unauthenticated resolution attempt', async () => {
      const { escrowId } = await createEscrowAndDispute();

      await request(app.getHttpServer())
        .patch(`/admin/dispute/${escrowId}/resolve`)
        .send({ resolution: 'RELEASE' })
        .expect(401);
    });
  });
});
