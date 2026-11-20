/**
 * Integration tests for GET /admin/audit-log (issue #798).
 *
 * This route previously had only a controller unit spec, which mocks
 * AuditLogService and so exercises nothing but delegation. This test boots
 * the real AppModule and a real database, so it actually exercises admin
 * authorisation and the query together — the audit log is the record of who
 * resolved which dispute, so an authorisation regression here is worth
 * catching.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';

type TestServer = Parameters<typeof request>[0];
type AuditLogResponseBody = {
  total: number;
  data: Array<{
    action: string;
    adminAddress: string;
    entityType: string;
    entityId: string;
  }>;
  page: number;
  limit: number;
};

describe('GET /admin/audit-log integration (issue #798)', () => {
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

    await prisma.auditLog.create({
      data: {
        id: 'audit-1',
        action: 'DISPUTE_RESOLVED',
        adminAddress,
        entityType: 'Dispute',
        entityId: 'dispute-1',
        details: { resolution: 'REFUND_BUYER' },
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await prisma.auditLog.create({
      data: {
        id: 'audit-2',
        action: 'DISPUTE_RESOLVED',
        adminAddress,
        entityType: 'Dispute',
        entityId: 'dispute-2',
        details: { resolution: 'RELEASE_VENDOR' },
        occurredAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });

    await prisma.auditLog.create({
      data: {
        id: 'audit-3',
        action: 'DLQ_REQUEUED',
        adminAddress,
        entityType: 'DeadLetterJob',
        entityId: 'job-1',
        details: {},
        occurredAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function signedJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload }),
    ).toString('base64url');
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

  it('returns all audit log entries for an authenticated admin', async () => {
    const res = await request(httpServer())
      .get('/admin/audit-log')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .expect(200);
    const body = res.body as AuditLogResponseBody;

    expect(body.total).toBe(3);
    expect(body.data).toHaveLength(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
    expect(body.hasNextPage).toBe(false);
    expect(body.data.map((entry) => entry.entityId).sort()).toEqual([
      'dispute-1',
      'dispute-2',
      'job-1',
    ]);
  });

  it('paginates audit log entries correctly', async () => {
    const res = await request(httpServer())
      .get('/admin/audit-log')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .query({ page: 1, limit: 2 })
      .expect(200);
    const body = res.body as AuditLogResponseBody;

    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(2);

    const secondPage = await request(httpServer())
      .get('/admin/audit-log')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .query({ page: 2, limit: 2 })
      .expect(200);
    const secondBody = secondPage.body as AuditLogResponseBody;

    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.page).toBe(2);
    expect(secondBody.totalPages).toBe(2);
    expect(secondBody.hasNextPage).toBe(false);
  });

  it.each([
    ['page=abc', 'non-numeric page'],
    ['page=0', 'page below minimum'],
    ['limit=0', 'limit below minimum'],
    ['limit=101', 'limit above maximum'],
  ])('rejects %s with 400 (%s)', async (query) => {
    await request(httpServer())
      .get(`/admin/audit-log?${query}`)
      .set('Authorization', `Bearer ${adminJwt()}`)
      .expect(400);
  });

  it('returns 403 for a non-admin authenticated user', async () => {
    await request(httpServer())
      .get('/admin/audit-log')
      .set('Authorization', `Bearer ${vendorJwt()}`)
      .expect(403);
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(httpServer()).get('/admin/audit-log').expect(401);
  });

  describe('filters (issue #1119)', () => {
    async function list(query: Record<string, string | number>) {
      const res = await request(httpServer())
        .get('/admin/audit-log')
        .set('Authorization', `Bearer ${adminJwt()}`)
        .query(query)
        .expect(200);
      return res.body as AuditLogResponseBody;
    }

    it('filters by action', async () => {
      const body = await list({ action: 'DLQ_REQUEUED' });

      expect(body.total).toBe(1);
      expect(body.data.map((entry) => entry.entityId)).toEqual(['job-1']);
    });

    it('filters by entityType', async () => {
      const body = await list({ entityType: 'Dispute' });

      expect(body.total).toBe(2);
      expect(body.data.map((entry) => entry.entityId).sort()).toEqual([
        'dispute-1',
        'dispute-2',
      ]);
    });

    it('filters by entityId', async () => {
      const body = await list({ entityId: 'dispute-2' });

      expect(body.total).toBe(1);
      expect(body.data[0].entityId).toBe('dispute-2');
    });

    it('filters by adminAddress and returns nothing for an unknown admin', async () => {
      const matching = await list({ adminAddress: adminAddress });
      expect(matching.total).toBe(3);

      const unknown = await list({ adminAddress: 'GUNKNOWNADMINADDRESS' });
      expect(unknown.total).toBe(0);
      expect(unknown.data).toEqual([]);
    });

    it('filters by from (inclusive lower bound on occurredAt)', async () => {
      const body = await list({ from: '2026-01-02T00:00:00.000Z' });

      expect(body.total).toBe(2);
      expect(body.data.map((entry) => entry.entityId).sort()).toEqual([
        'dispute-2',
        'job-1',
      ]);
    });

    it('filters by to (inclusive upper bound on occurredAt)', async () => {
      const body = await list({ to: '2026-01-01T23:59:59.999Z' });

      expect(body.total).toBe(1);
      expect(body.data[0].entityId).toBe('dispute-1');
    });

    it('combines action and entityId filters', async () => {
      const body = await list({
        action: 'DISPUTE_RESOLVED',
        entityId: 'dispute-1',
      });

      expect(body.total).toBe(1);
      expect(body.data[0].entityId).toBe('dispute-1');
    });

    it('combines from and to into a date window', async () => {
      const body = await list({
        from: '2026-01-02T00:00:00.000Z',
        to: '2026-01-02T23:59:59.999Z',
      });

      expect(body.total).toBe(1);
      expect(body.data[0].entityId).toBe('dispute-2');
    });

    it('reports the filtered total, not the unfiltered count, on a paginated page', async () => {
      const body = await list({ entityType: 'Dispute', page: 1, limit: 1 });

      expect(body.total).toBe(2);
      expect(body.data).toHaveLength(1);
      expect(body.limit).toBe(1);
    });
  });
});
