/**
 * E2E test for the vendor lifecycle (issue #801).
 *
 * The escrow and dispute flows have e2e coverage, but no e2e test touches
 * any /vendor route. This walks the sequence a real vendor performs against
 * a live HTTP server and a real database: create a profile, set account
 * details, update notification preferences, list escrows, read analytics.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer } from './auth-helper';
import { ensureVendors } from './prisma-helpers';

describe('Vendor lifecycle (e2e) (issue #801)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR = 'GVENDORLIFECYCLE001';
  const AUTH = bearer(VENDOR);

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
    await prisma.reset();
    // Escrow.vendorAddress (and the vendor settings/details tables) are
    // foreign keys onto VendorProfile.address, so the parent row must exist
    // before any row referencing it can be written (#475).
    await ensureVendors(prisma, VENDOR);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a profile, sets account details, updates notification prefs, lists escrows and reads analytics', async () => {
    // ── 1. Create a vendor profile ──────────────────────────────────────
    const createProfileRes = await request(app.getHttpServer())
      .post('/vendor/profile')
      .set('Authorization', AUTH)
      .send({
        businessName: 'Lifecycle Trading Co',
        email: 'ops@lifecycle-trading.example',
        phone: '+1-415-555-0100',
      })
      .expect(201);

    expect(createProfileRes.body).toMatchObject({
      address: VENDOR,
      businessName: 'Lifecycle Trading Co',
      email: 'ops@lifecycle-trading.example',
    });

    // ── 2. Set account details ──────────────────────────────────────────
    const accountDetailsRes = await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .set('Authorization', AUTH)
      .send({
        businessLicense: 'LIC-LIFECYCLE-001',
        bankAccountNumber: '1234567890123456',
        preferredCurrency: 'USDC',
      })
      .expect(200);

    expect(accountDetailsRes.body.businessLicense).toBe('LIC-LIFECYCLE-001');
    // Sensitive fields are masked in the response (last 4 digits visible).
    expect(accountDetailsRes.body.bankAccountNumber).toBe('************3456');

    // ── 3. Update notification preferences ──────────────────────────────
    const notificationsRes = await request(app.getHttpServer())
      .patch('/vendor/profile/notifications')
      .set('Authorization', AUTH)
      .send({
        notifyOnDelay: false,
        notificationChannels: ['EMAIL', 'SMS'],
      })
      .expect(200);

    expect(notificationsRes.body.trackingSettings).toMatchObject({
      notifyOnDelay: false,
      notificationChannels: expect.arrayContaining(['EMAIL', 'SMS']),
    });

    // Confirm the update persisted.
    const getNotificationsRes = await request(app.getHttpServer())
      .get('/vendor/profile/notifications')
      .set('Authorization', AUTH)
      .expect(200);

    expect(getNotificationsRes.body.notifyOnDelay).toBe(false);

    // Seed an escrow directly so the list/analytics steps have data to read.
    // Vendors don't create their own escrows (buyers do), so this mirrors a
    // buyer having already opened one against this vendor.
    await prisma.escrow.create({
      data: {
        itemName: 'Lifecycle test item',
        itemRef: 'ref-vendor-lifecycle-001',
        amount: 250,
        currency: 'USDC',
        buyerAddress: 'GBUYERLIFECYCLE001',
        vendorAddress: VENDOR,
      },
    });

    // ── 4. List escrows ──────────────────────────────────────────────────
    const escrowsRes = await request(app.getHttpServer())
      .get('/vendor/escrows')
      .set('Authorization', AUTH)
      .expect(200);

    expect(escrowsRes.body.total).toBe(1);
    expect(escrowsRes.body.data).toHaveLength(1);
    expect(escrowsRes.body.data[0]).toMatchObject({
      itemName: 'Lifecycle test item',
    });

    // ── 5. Read analytics ────────────────────────────────────────────────
    const analyticsRes = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH)
      .expect(200);

    expect(analyticsRes.body.stats.totalTransactions).toBe(1);
    expect(Number(analyticsRes.body.stats.totalVolume)).toBe(250);
  });

  it('rejects every vendor route for an unauthenticated caller', async () => {
    await request(app.getHttpServer()).post('/vendor/profile').expect(401);
    await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/vendor/profile/notifications')
      .expect(401);
    await request(app.getHttpServer()).get('/vendor/escrows').expect(401);
    await request(app.getHttpServer()).get('/vendor/analytics').expect(401);
  });
});
