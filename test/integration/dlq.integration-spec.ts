/**
 * Integration tests for DLQ endpoints (issue #640).
 *
 * Drives every route on DlqController over HTTP through the Nest testing
 * module.  Verifies authentication, admin-only authorisation, validation,
 * and the real HTTP status codes returned by the controller.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('DLQ endpoints (issue #640)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
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
    adminAddress = configService.get('ADMIN_ADDRESS');
    jwtSecret = configService.get('SEP10_JWT_SECRET');
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

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

  function nonAdminJwt(): string {
    return signedJwt({ sub: 'GNONADMINADDRESS', role: 'vendor' });
  }

  async function seedDlqEntry(
    overrides?: Partial<{
      operation: string;
      escrowId: string | null;
      errorMessage: string;
      status: string;
    }>,
  ) {
    return prisma.failedTransaction.create({
      data: {
        operation: overrides?.operation ?? 'submitAutoRelease',
        escrowId: overrides?.escrowId ?? null,
        errorMessage: overrides?.errorMessage ?? 'Stellar network timeout',
        ledgerFeedback: Prisma.DbNull,
        status: (overrides?.status as any) ?? 'PENDING_REVIEW',
        attempts: 1,
      },
    });
  }

  // ── GET /admin/dlq ─────────────────────────────────────────────────────

  describe('GET /admin/dlq', () => {
    it('lists DLQ entries with default pagination', async () => {
      await seedDlqEntry({ operation: 'submitAutoRelease' });
      await seedDlqEntry({ operation: 'recordDelivery' });

      const res = await request(app.getHttpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
    });

    it('filters by status', async () => {
      const entry = await seedDlqEntry();
      await prisma.failedTransaction.update({
        where: { id: entry.id },
        data: { status: 'ABANDONED' },
      });
      await seedDlqEntry();

      const res = await request(app.getHttpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .query({ status: 'PENDING_REVIEW' })
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('PENDING_REVIEW');
    });

    it('filters by operation', async () => {
      await seedDlqEntry({ operation: 'submitAutoRelease' });
      await seedDlqEntry({ operation: 'recordDelivery' });

      const res = await request(app.getHttpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .query({ operation: 'submitAutoRelease' })
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].operation).toBe('submitAutoRelease');
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/admin/dlq').expect(401);
    });

    it('returns 403 for non-admin users', async () => {
      await request(app.getHttpServer())
        .get('/admin/dlq')
        .set('Authorization', `Bearer ${nonAdminJwt()}`)
        .expect(403);
    });
  });

  // ── GET /admin/dlq/:id ─────────────────────────────────────────────────

  describe('GET /admin/dlq/:id', () => {
    it('returns a single DLQ entry', async () => {
      const entry = await seedDlqEntry();

      const res = await request(app.getHttpServer())
        .get(`/admin/dlq/${entry.id}`)
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(200);

      expect(res.body.id).toBe(entry.id);
      expect(res.body.operation).toBe('submitAutoRelease');
      expect(res.body.status).toBe('PENDING_REVIEW');
    });

    it('returns 404 for non-existent entry', async () => {
      await request(app.getHttpServer())
        .get('/admin/dlq/non-existent-id')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(404);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const entry = await seedDlqEntry();

      await request(app.getHttpServer())
        .get(`/admin/dlq/${entry.id}`)
        .expect(401);
    });

    it('returns 403 for non-admin users', async () => {
      const entry = await seedDlqEntry();

      await request(app.getHttpServer())
        .get(`/admin/dlq/${entry.id}`)
        .set('Authorization', `Bearer ${nonAdminJwt()}`)
        .expect(403);
    });
  });

  // ── POST /admin/dlq/:id/abandon ────────────────────────────────────────

  describe('POST /admin/dlq/:id/abandon', () => {
    it('abandons a DLQ entry', async () => {
      const entry = await seedDlqEntry();

      const res = await request(app.getHttpServer())
        .post(`/admin/dlq/${entry.id}/abandon`)
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(201);

      expect(res.body.status).toBe('ABANDONED');
      expect(res.body.reviewedAt).not.toBeNull();
    });

    it('returns 404 for non-existent entry', async () => {
      await request(app.getHttpServer())
        .post('/admin/dlq/non-existent-id/abandon')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(404);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const entry = await seedDlqEntry();

      await request(app.getHttpServer())
        .post(`/admin/dlq/${entry.id}/abandon`)
        .expect(401);
    });

    it('returns 403 for non-admin users', async () => {
      const entry = await seedDlqEntry();

      await request(app.getHttpServer())
        .post(`/admin/dlq/${entry.id}/abandon`)
        .set('Authorization', `Bearer ${nonAdminJwt()}`)
        .expect(403);
    });
  });

  // ── POST /admin/dlq/:id/replay ─────────────────────────────────────────

  describe('POST /admin/dlq/:id/replay', () => {
    it('returns 404 for non-existent entry', async () => {
      await request(app.getHttpServer())
        .post('/admin/dlq/non-existent-id/replay')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .expect(404);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const entry = await seedDlqEntry();

      await request(app.getHttpServer())
        .post(`/admin/dlq/${entry.id}/replay`)
        .expect(401);
    });

    it('returns 403 for non-admin users', async () => {
      const entry = await seedDlqEntry();

      await request(app.getHttpServer())
        .post(`/admin/dlq/${entry.id}/replay`)
        .set('Authorization', `Bearer ${nonAdminJwt()}`)
        .expect(403);
    });
  });
});
