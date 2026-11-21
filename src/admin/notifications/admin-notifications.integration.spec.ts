import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { bearer } from '../../../test/auth-helper';
import { ensureVendors } from '../../../test/prisma-helpers';

const VENDOR_ADDRESS = 'GADMINNOTIFVENDOR001';
const BUYER_ADDRESS = 'GADMINNOTIFBUYER001';
const NON_ADMIN_ADDRESS = 'GNONADMIN001';

describe('Admin notifications integration (issue #1169)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAddress: string;
  let escrowId: string;

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
    adminAddress = app.get(ConfigService).get('ADMIN_ADDRESS');
  });

  beforeEach(async () => {
    await prisma.reset();
    await ensureVendors(prisma, VENDOR_ADDRESS);

    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Camera',
        itemRef: 'REF-CAM-1',
        amount: 800,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
      },
    });
    escrowId = escrow.id;

    // Seed mixed statuses: PENDING, SENT, FAILED
    await prisma.notification.create({
      data: {
        escrowId,
        type: 'FUNDED',
        channel: 'EMAIL',
        recipientAddress: 'buyer@example.com',
        message: 'Your escrow is funded',
        status: 'PENDING',
        attemptCount: 0,
      },
    });

    await prisma.notification.create({
      data: {
        escrowId,
        type: 'SHIPPED',
        channel: 'SMS',
        recipientAddress: '+1234567890',
        message: 'Your item shipped',
        status: 'SENT',
        sentAt: new Date(),
        attemptCount: 1,
        providerMessageId: 'prov-sms-1',
        lastResponseCode: 200,
      },
    });

    await prisma.notification.create({
      data: {
        escrowId,
        type: 'DELIVERED',
        channel: 'EMAIL',
        recipientAddress: 'buyer@example.com',
        message: 'Your item was delivered',
        status: 'FAILED',
        failedAt: new Date(),
        attemptCount: 3,
        lastError: 'SMTP 550 Mailbox unavailable',
        lastResponseCode: 550,
      },
    });
  });

  afterAll(async () => {
    await prisma.reset();
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects unauthorized requests with 401', async () => {
    await request(app.getHttpServer()).get('/admin/notifications').expect(401);
  });

  it('rejects non-admin requests with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/notifications')
      .set('Authorization', bearer(NON_ADMIN_ADDRESS))
      .expect(403);
  });

  it('returns mixed statuses, lastError, and lastResponseCode, but NEVER recipientAddress or message', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/notifications')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(3);

    const statuses = res.body.data.map((n: { status: string }) => n.status);
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('SENT');
    expect(statuses).toContain('FAILED');

    const failed = res.body.data.find(
      (n: { status: string }) => n.status === 'FAILED',
    );
    expect(failed.lastError).toBe('SMTP 550 Mailbox unavailable');
    expect(failed.lastResponseCode).toBe(550);

    // Verify privacy: recipientAddress and message must be absent on all rows
    for (const item of res.body.data) {
      expect(item.recipientAddress).toBeUndefined();
      expect(item.message).toBeUndefined();
    }
  });

  it('filters by status, channel, and type', async () => {
    const resFailed = await request(app.getHttpServer())
      .get('/admin/notifications?status=FAILED')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(resFailed.body.total).toBe(1);
    expect(resFailed.body.data[0].status).toBe('FAILED');

    const resSms = await request(app.getHttpServer())
      .get('/admin/notifications?channel=SMS')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(resSms.body.total).toBe(1);
    expect(resSms.body.data[0].channel).toBe('SMS');

    const resDelivered = await request(app.getHttpServer())
      .get('/admin/notifications?type=DELIVERED')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(resDelivered.body.total).toBe(1);
    expect(resDelivered.body.data[0].type).toBe('DELIVERED');
  });
});
