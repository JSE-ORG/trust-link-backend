import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('POST /escrow/:id/dispute integration (issue #51)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const vendorAddress = 'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
  const buyerAddress = 'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';
  const nonExistentUuid = '00000000-0000-4000-8000-000000000099';

  const escrowUuid = '00000000-0000-4000-8000-000000000010';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.reset();

    await prisma.escrow.create({
      data: {
        id: escrowUuid,
        itemName: 'Disputable Item',
        itemRef: 'DSP-CREATE-001',
        amount: 250,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'SHIPPED',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a dispute and returns 201 for a valid request', async () => {
    const res = await request(app.getHttpServer())
      .post(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .send({
        reason: 'ITEM_NOT_RECEIVED',
        description: 'The package has not arrived after 3 weeks of waiting',
      })
      .expect(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        escrowId: escrowUuid,
        reason: 'ITEM_NOT_RECEIVED',
        status: 'OPEN',
      }),
    );
    expect(res.body.id).toBeDefined();

    const dbDispute = await prisma.dispute.findUnique({ where: { id: res.body.id } });
    expect(dbDispute).not.toBeNull();
    expect(dbDispute!.escrowId).toBe(escrowUuid);
  });

  it('returns 409 if a dispute already exists', async () => {
    await prisma.dispute.create({
      data: {
        escrowId: escrowUuid,
        reason: 'DAMAGED_ITEM',
        description: 'Item was damaged during shipping and is unusable',
        status: 'OPEN',
      },
    });

    await request(app.getHttpServer())
      .post(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .send({
        reason: 'ITEM_NOT_RECEIVED',
        description: 'The package has not arrived after 3 weeks of waiting',
      })
      .expect(409);
  });

  it('returns 400 for invalid dispute reason', async () => {
    await request(app.getHttpServer())
      .post(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .send({
        reason: 'INVALID_REASON',
        description: 'This reason is not a valid enum value',
      })
      .expect(400);
  });

  it('returns 400 for short description', async () => {
    await request(app.getHttpServer())
      .post(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .send({
        reason: 'OTHER',
        description: 'Too short',
      })
      .expect(400);
  });

  it('returns 403 for unauthorized user', async () => {
    const stranger = 'GCD53U57NWPPB2AGR25MEEDXW36GIYXBAWB7NCUT3JGC6YBKUJ22WQL7';
    await request(app.getHttpServer())
      .post(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({
        reason: 'FRAUD',
        description: 'The seller attempted to scam me with fake tracking',
      })
      .expect(403);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .post(`/escrow/${escrowUuid}/dispute`)
      .send({
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description: 'Item was completely different from the listing photos',
      });

    expect([401, 429]).toContain(res.status);
  });

  it('returns 404 for non-existent escrow', async () => {
    const res = await request(app.getHttpServer())
      .post(`/escrow/${nonExistentUuid}/dispute`)
      .set('Authorization', `Bearer ${buyerAddress}`)
      .send({
        reason: 'ITEM_NOT_RECEIVED',
        description: 'Package never arrived at my address',
      });

    expect([404, 429]).toContain(res.status);
  });
});
