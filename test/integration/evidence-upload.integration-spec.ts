/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Integration tests for POST /escrow/evidence-upload (issue #295).
 *
 * Verifies pre-signed URL generation, file type handling, JWT auth requirement,
 * URL expiration, and user-specific path isolation.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('POST /escrow/evidence-upload (issue #295)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_ADDR = 'GEVIDENCEVENDOR001';
  const AUTH = `Bearer ${VENDOR_ADDR}`;

  jest.setTimeout(30000);

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
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Successful pre-signed URL generation ──────────────────────────────────

  it('returns a pre-signed upload URL for a valid request', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'damage-photo.jpg' })
      .expect(201);

    expect(res.body).toHaveProperty('uploadUrl');
    expect(res.body).toHaveProperty('publicUrl');
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body).toHaveProperty('expiresInSeconds');
    expect(res.body).toHaveProperty('fileName');
    expect(res.body).toHaveProperty('storagePath');

    expect(typeof res.body.uploadUrl).toBe('string');
    expect(res.body.uploadUrl.length).toBeGreaterThan(0);
  });

  it('includes correct fileName in the response', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'receipt.pdf' })
      .expect(201);

    expect(res.body.fileName).toBe('receipt.pdf');
  });

  it('includes correct expiration time (3600 seconds)', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'photo.png' })
      .expect(201);

    expect(res.body.expiresInSeconds).toBe(3600);

    const expiresAt = new Date(res.body.expiresAt);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffSeconds = diffMs / 1000;

    expect(diffSeconds).toBeGreaterThan(3500);
    expect(diffSeconds).toBeLessThanOrEqual(3600);
  });

  // ── URL includes user-specific path isolation ──────────────────────────────

  it('includes user-specific storage path for path isolation', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'evidence.jpg' })
      .expect(201);

    expect(res.body.storagePath).toContain(`evidence/${VENDOR_ADDR}/`);
    expect(res.body.publicUrl).toContain(`evidence/${VENDOR_ADDR}/`);
  });

  it('generates unique storage paths for different requests', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'photo1.jpg' })
      .expect(201);

    const res2 = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'photo2.jpg' })
      .expect(201);

    expect(res1.body.publicUrl).not.toBe(res2.body.publicUrl);
  });

  // ── File type handling ─────────────────────────────────────────────────────

  it('preserves the file extension in the public URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'document.pdf' })
      .expect(201);

    expect(res.body.publicUrl).toContain('.pdf');
  });

  it('handles filenames without extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'noext' })
      .expect(201);

    expect(res.body.uploadUrl).toBeDefined();
    expect(res.body.publicUrl).toContain(`evidence/${VENDOR_ADDR}/`);
  });

  // ── JWT auth requirement ───────────────────────────────────────────────────

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .query({ fileName: 'photo.jpg' })
      .expect(401);
  });

  it('returns 401 for requests with empty authorization header', async () => {
    await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', '')
      .query({ fileName: 'photo.jpg' })
      .expect(401);
  });

  it('returns 401 for requests with invalid token format', async () => {
    await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', 'InvalidToken')
      .query({ fileName: 'photo.jpg' })
      .expect(401);
  });

  // ── Pre-signed URL format ──────────────────────────────────────────────────

  it('returns a pre-signed URL with signature parameters', async () => {
    const res = await request(app.getHttpServer())
      .post('/escrow/evidence-upload')
      .set('Authorization', AUTH)
      .query({ fileName: 'photo.jpg' })
      .expect(201);

    expect(res.body.uploadUrl).toContain('X-Expires=');
    expect(res.body.uploadUrl).toContain('X-Signature=');
  });
});
