/**
 * Integration tests for GET /admin/stats (issue #639).
 *
 * Exercises the AdminStatsController over HTTP through the Nest testing
 * module.  Verifies authentication, admin-only authorisation, and the
 * response shape returned by AdminStatsService.getStats().
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';

describe('Admin Stats (issue #639)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let adminAddress: string;

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
    configService = app.get(ConfigService);
    adminAddress = configService.get('ADMIN_ADDRESS');
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedEscrow(overrides?: { vendorAddress?: string; amount?: number }) {
    const vendorAddress = overrides?.vendorAddress ?? 'GVENDORSTATS001';
    await prisma.vendorProfile.upsert({
      where: { address: vendorAddress },
      update: {},
      create: {
        address: vendorAddress,
        businessName: `Vendor ${vendorAddress}`,
      },
    });

    return prisma.escrow.create({
      data: {
        itemName: 'Test Item',
        itemRef: `ref-stats-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        amount: overrides?.amount ?? 250,
        currency: 'USDC',
        buyerAddress: 'GBUYER001',
        vendorAddress,
        state: 'FUNDED',
      },
    });
  }

  // ── Successful retrieval ────────────────────────────────────────────────

  it('returns aggregated stats for the platform', async () => {
    await seedEscrow({ vendorAddress: 'GVENDORSTATS001', amount: 100 });
    await seedEscrow({ vendorAddress: 'GVENDORSTATS001', amount: 200 });
    await seedEscrow({ vendorAddress: 'GVENDORSTATS002', amount: 50 });

    const res = await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(res.body.totalEscrows).toBe(3);
    expect(res.body.totalVolume).toBe(350);
    expect(res.body.uniqueVendors).toBe(2);
    expect(res.body.uniqueBuyers).toBeGreaterThanOrEqual(1);
    expect(res.body).toHaveProperty('escrowsByState');
    expect(res.body).toHaveProperty('totalDisputes');
    expect(res.body).toHaveProperty('openDisputes');
    expect(typeof res.body.averageEscrowAmount).toBe('number');
  });

  it('returns zero stats when no data exists', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(res.body.totalEscrows).toBe(0);
    expect(res.body.totalVolume).toBe(0);
    expect(res.body.uniqueVendors).toBe(0);
    expect(res.body.uniqueBuyers).toBe(0);
    expect(res.body.totalDisputes).toBe(0);
    expect(res.body.openDisputes).toBe(0);
    expect(res.body.averageEscrowAmount).toBe(0);
  });

  // ── Authentication and authorisation ─────────────────────────────────────

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats')
      .expect(401);
  });

  it('returns 403 for non-admin users', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', bearer('GVENDORNOTADMIN'))
      .expect(403);
  });
});
