/**
 * Integration tests for two previously uncovered routes (issue #1122):
 *
 *  - PATCH /admin/credentials/logistics — missing CREDENTIAL_ROTATED audit log
 *    assertion and vendor 403 / anon 401 coverage.
 *  - GET  /stress-test/active/:testId   — 404 on unknown id, 403 for vendor,
 *    401 for unauthenticated.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';

describe('Missing route coverage (issue #1122)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    adminAddress = app.get(ConfigService).get('ADMIN_ADDRESS');
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── PATCH /admin/credentials/logistics ───────────────────────────────────

  describe('PATCH /admin/credentials/logistics', () => {
    const ROUTE = '/admin/credentials/logistics';
    const NEW_KEY = 'tl_live_route_coverage_test_key_0001';

    it('writes a CREDENTIAL_ROTATED audit log entry on successful rotation', async () => {
      await request(app.getHttpServer())
        .patch(ROUTE)
        .set('Authorization', bearer(adminAddress, { role: 'admin' }))
        .send({ key: NEW_KEY })
        .expect(200);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'CREDENTIAL_ROTATED' },
      });
      expect(log).not.toBeNull();
      expect(log!.entityType).toBe('logistics_provider');
      expect(log!.entityId).toBe('logistics');
    });

    it('returns 403 for a vendor caller', async () => {
      const vendor = Keypair.random().publicKey();
      await request(app.getHttpServer())
        .patch(ROUTE)
        .set('Authorization', bearer(vendor))
        .send({ key: NEW_KEY })
        .expect(403);
    });

    it('returns 401 for an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .patch(ROUTE)
        .send({ key: NEW_KEY })
        .expect(401);
    });
  });

  // ── GET /stress-test/active/:testId ──────────────────────────────────────

  describe('GET /stress-test/active/:testId', () => {
    it('returns 404 for an unknown test id', async () => {
      await request(app.getHttpServer())
        .get('/stress-test/active/nonexistent-test-id-xyz')
        .set('Authorization', bearer(adminAddress, { role: 'admin' }))
        .expect(404);
    });

    it('returns 403 for a vendor caller', async () => {
      const vendor = Keypair.random().publicKey();
      await request(app.getHttpServer())
        .get('/stress-test/active/any-id')
        .set('Authorization', bearer(vendor))
        .expect(403);
    });

    it('returns 401 for an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .get('/stress-test/active/any-id')
        .expect(401);
    });
  });
});
