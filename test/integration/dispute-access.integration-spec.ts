import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '../../src/config/config.service';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

describe('GET /escrow/:id/dispute access control integration (issue #52)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAddress: string;

  const vendorAddress =
    'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
  const buyerAddress =
    'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';
  const strangerAddress =
    'GDTM7BUWHKUNZQVC3TA2O3NESSWCD26CHH6ORQLB4JCO6JXF4L3EUVCL';
  const nonExistentUuid = '00000000-0000-4000-8000-000000000099';

  const escrowUuid = '00000000-0000-4000-8000-000000000010';
  const disputeUuid = '00000000-0000-4000-8000-000000000020';
  const noDisputeEscrowUuid = '00000000-0000-4000-8000-000000000030';

  // Replaced a hand-rolled JWT builder with the shared helper so there is one
  // place that has to stay in step with Sep10Service.issueJwt.
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
    // Escrow.vendorAddress is a foreign key onto VendorProfile.address, so
    // the parent row must exist before any escrow referencing it (#475).
    await ensureVendors(
      prisma,
      'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3',
    );

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
      .set('Authorization', bearer(buyerAddress))
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
      .set('Authorization', bearer(vendorAddress))
      .expect(200);

    expect(res.body.id).toBe(disputeUuid);
  });

  it('allows admin to retrieve dispute details', async () => {
    const res = await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', adminAuth())
      .expect(200);

    expect(res.body.id).toBe(disputeUuid);
  });

  it('blocks unauthorized users from viewing dispute', async () => {
    await request(app.getHttpServer())
      .get(`/escrow/${escrowUuid}/dispute`)
      .set('Authorization', bearer(strangerAddress))
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
      .set('Authorization', bearer(buyerAddress))
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
      .set('Authorization', bearer(buyerAddress))
      .expect(404);
  });
});
