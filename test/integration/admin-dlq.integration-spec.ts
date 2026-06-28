import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';

type TestServer = Parameters<typeof request>[0];

describe('Admin DLQ Operations (issue #297)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let contractService: ContractService;
  let adminAddress: string;
  let jwtSecret: string;

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
    configService = app.get(ConfigService);
    contractService = app.get(ContractService);
    adminAddress = configService.get('ADMIN_ADDRESS');
    jwtSecret = configService.get('SEP10_JWT_SECRET');
  });

  beforeEach(async () => {
    await prisma.reset();

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue('tx-hash-replayed-001');
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  function adminJwt(): string {
    return signedJwt({ sub: adminAddress, role: 'admin' });
  }

  function vendorJwt(): string {
    return signedJwt({ sub: 'GVENDOR_ADDRESS', role: 'vendor' });
  }

  function httpServer(): TestServer {
    return app.getHttpServer() as TestServer;
  }

  async function seedDlqEntry(
    overrides?: Partial<{
      operation: string;
      escrowId: string | null;
      errorMessage: string;
    }>,
  ) {
    return prisma.failedTransaction.create({
      data: {
        operation: overrides?.operation ?? 'submitAutoRelease',
        escrowId: overrides?.escrowId ?? null,
        errorMessage: overrides?.errorMessage ?? 'Stellar network timeout',
        status: 'PENDING_REVIEW',
        attempts: 1,
      },
    });
  }

  describe('GET /admin/dlq', () => {
    it('lists DLQ entries', async () => {
      await seedDlqEntry({ operation: 'submitAutoRelease' });
      await seedDlqEntry({
        operation: 'recordDelivery',
        errorMessage: 'Horizon error',
      });

      const res = await request(httpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('filters by status', async () => {
      const entry = await seedDlqEntry();
      await prisma.failedTransaction.update({
        where: { id: entry.id },
        data: { status: 'ABANDONED' },
      });
      await seedDlqEntry();

      const res = await request(httpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .query({ status: 'PENDING_REVIEW' })
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('PENDING_REVIEW');
    });

    it('filters by operation', async () => {
      await seedDlqEntry({ operation: 'submitAutoRelease' });
      await seedDlqEntry({ operation: 'recordDelivery' });

      const res = await request(httpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .query({ operation: 'submitAutoRelease' })
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].operation).toBe('submitAutoRelease');
    });
  });

  describe('GET /admin/dlq/:id', () => {
    it('returns a single DLQ entry', async () => {
      const entry = await seedDlqEntry();

      const res = await request(httpServer())
        .get(`/admin/dlq/${entry.id}`)
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(200);

      expect(res.body.id).toBe(entry.id);
      expect(res.body.operation).toBe('submitAutoRelease');
      expect(res.body.status).toBe('PENDING_REVIEW');
    });

    it('returns 404 for non-existent entry', async () => {
      await request(httpServer())
        .get('/admin/dlq/non-existent-id')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(404);
    });
  });

  describe('POST /admin/dlq/:id/replay', () => {
    it('replays a submitAutoRelease operation', async () => {
      const entry = await seedDlqEntry({
        operation: 'submitAutoRelease',
        escrowId: 'escrow-replay-001',
      });

      const res = await request(httpServer())
        .post(`/admin/dlq/${entry.id}/replay`)
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(201);

      expect(res.body.status).toBe('REPLAYED');
      expect(res.body.lastReplayTxHash).toBe('tx-hash-replayed-001');
      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
        'escrow-replay-001',
      );
    });

    it('returns 404 for non-existent entry', async () => {
      await request(httpServer())
        .post('/admin/dlq/non-existent-id/replay')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(404);
    });
  });

  describe('POST /admin/dlq/:id/abandon', () => {
    it('abandons a DLQ entry', async () => {
      const entry = await seedDlqEntry();

      const res = await request(httpServer())
        .post(`/admin/dlq/${entry.id}/abandon`)
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(201);

      expect(res.body.status).toBe('ABANDONED');
      expect(res.body.reviewedAt).not.toBeNull();
    });
  });

  describe('Authorization', () => {
    it('returns 403 for non-admin users', async () => {
      await request(httpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${vendorJwt()}`)
        .expect(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(httpServer()).get('/admin/dlq').expect(401);
    });
  });
});
