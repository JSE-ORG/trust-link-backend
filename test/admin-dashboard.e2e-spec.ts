import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ConfigService } from '../src/config/config.service';
import { ContractService } from '../src/stellar/contract.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer } from './auth-helper';
import { ensureVendors } from './prisma-helpers';

const VENDOR_ADDRESS = 'GADMINVENDOR001';
const BUYER_ADDRESS = 'GADMINBUYER001';
const NON_ADMIN_ADDRESS = 'GADMINNONADMIN001';

describe('Admin dashboard E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAddress: string;
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
    adminAddress = app.get(ConfigService).get('ADMIN_ADDRESS');
    await prisma.reset();
    await ensureVendors(prisma, VENDOR_ADDRESS);
    jest
      .spyOn(contractService, 'resolveDispute')
      .mockResolvedValue('admin-action-tx');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  async function seedDashboard() {
    const created = await prisma.escrow.create({
      data: {
        itemName: 'Created dashboard item',
        itemRef: 'admin-dashboard-created',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
        state: 'CREATED',
      },
    });
    const funded = await prisma.escrow.create({
      data: {
        itemName: 'Funded dashboard item',
        itemRef: 'admin-dashboard-funded',
        amount: 200,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
        state: 'FUNDED',
      },
    });
    const disputed = await prisma.escrow.create({
      data: {
        itemName: 'Disputed dashboard item',
        itemRef: 'admin-dashboard-disputed',
        amount: 300,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
        state: 'DISPUTED',
        contractEscrowId: 77n,
      },
    });
    await prisma.dispute.create({
      data: {
        escrowId: disputed.id,
        reason: 'Dashboard test',
        status: 'OPEN',
      },
    });
    return { created, funded, disputed };
  }

  it('returns seeded stats, records an admin action, and paginates its audit log', async () => {
    const seeded = await seedDashboard();

    const stats = await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);
    expect(stats.body.totalEscrows).toBe(3);
    expect(stats.body.totalVolume).toBe(600);
    expect(stats.body.escrowsByState).toMatchObject({
      CREATED: 1,
      FUNDED: 1,
      DISPUTED: 1,
    });

    await request(app.getHttpServer())
      .patch(`/admin/dispute/${seeded.disputed.id}/resolve`)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .send({ resolution: 'RELEASE' })
      .expect(200);

    const firstPage = await request(app.getHttpServer())
      .get('/admin/audit-log')
      .query({ page: 1, limit: 1 })
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);
    expect(firstPage.body.total).toBe(1);
    expect(firstPage.body.data[0]).toMatchObject({
      action: 'DISPUTE_RESOLVED',
      entityId: seeded.disputed.id,
    });

    const secondPage = await request(app.getHttpServer())
      .get('/admin/audit-log')
      .query({ page: 2, limit: 1 })
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);
    expect(secondPage.body.data).toHaveLength(0);
  });

  it('rejects a non-admin caller on all dashboard routes', async () => {
    const authorization = { Authorization: bearer(NON_ADMIN_ADDRESS) };
    await request(app.getHttpServer())
      .get('/admin/stats')
      .set(authorization)
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/queues')
      .set(authorization)
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/audit-log')
      .set(authorization)
      .expect(403);
  });
});
