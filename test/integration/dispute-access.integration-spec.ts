import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('GET /escrow/:id/dispute access control integration (issue #52)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const vendorAddress =
    'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
  const buyerAddress =
    'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';
  const adminAddress =
    'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBFE3DMQUGMM';
  const strangerAddress =
    'GDTM7BUWHKUNZQVC3TA2O3NESSWCD26CHH6ORQLB4JCO6JXF4L3EUVCL';
  const nonExistentUuid = '00000000-0000-4000-8000-000000000099';

  const escrowUuid = '00000000-0000-4000-8000-000000000010';
  const disputeUuid = '00000000-0000-4000-8000-000000000020';
  const noDisputeEscrowUuid = '00000000-0000-4000-8000-000000000030';

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
  });

  beforeEach(async () => {
    await prisma.reset();

    await prisma.escrow.create({
      data: {
        id: escrowUuid,
        itemName: 'Disputed Item',
        itemRef: 'DSP-001',
        amount: 150,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'DISPUTED',
      },
    });

    await prisma.dispute.create({
      data: {
        id: disputeUuid,
        escrowId: escrowUuid,
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description:
          'The item received does not match the description provided',
        status: 'OPEN',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows buyer to retrieve dispute details', async () => {
    const res = await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        id: disputeUuid,
        escrowId: escrowUuid,
        reason: 'ITEM_NOT_AS_DESCRIBED',
        status: 'OPEN',
      }),
    );
  });

  it('allows vendor to retrieve dispute details', async () => {
    const res = await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${vendorAddress}`)
      .expect(200);

    expect(res.body.id).toBe(disputeUuid);
  });

  it('allows admin to retrieve dispute details', async () => {
    const res = await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${adminAddress}`)
      .expect(200);

    expect(res.body.id).toBe(disputeUuid);
  });

  it('blocks unauthorized users from viewing dispute', async () => {
    await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${strangerAddress}`)
      .expect(403);
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .expect(401);
  });

  it('returns 404 for non-existent escrow', async () => {
    await request(app.getHttpServer())
      .get(`/escrow/${nonExistentUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .expect(404);
  });

  it('returns 404 when no dispute exists for escrow', async () => {
    await prisma.escrow.create({
      data: {
        id: noDisputeEscrowUuid,
        itemName: 'No Dispute',
        itemRef: 'ND-001',
        amount: 50,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'FUNDED',
      },
    });

    await request(app.getHttpServer())
      .get(`/escrow/${noDisputeEscrowUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .expect(404);
  });
});
