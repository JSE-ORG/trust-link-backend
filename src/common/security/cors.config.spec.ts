import { Controller, Headers, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  getAllowedOriginsLogValue,
} from './cors.config';

/**
 * Issue #497: `POST /escrow` reads `Idempotency-Key`, but it was missing from
 * the CORS `allowedHeaders` list in `main.ts`, so a browser preflight never
 * advertised it and the actual request was blocked client-side.
 *
 * This builds a minimal Nest app with the same CORS options `main.ts` applies
 * and a stand-in controller that reads the same headers the real
 * `EscrowController` reads, so a header dropped from the allowlist fails this
 * test instead of only failing silently in a browser.
 */
@Controller('escrow')
class FixtureEscrowController {
  @Post()
  create(@Headers('idempotency-key') idempotencyKey?: string) {
    return { ok: true, idempotencyKey };
  }
}

describe('CORS allowedHeaders (issue #497)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FixtureEscrowController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableCors({
      origin: 'https://allowed-origin.example',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: CORS_ALLOWED_HEADERS,
      credentials: true,
      maxAge: 86400,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('advertises Idempotency-Key in the preflight response for POST /escrow', async () => {
    const response = await request(app.getHttpServer())
      .options('/escrow')
      .set('Origin', 'https://allowed-origin.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key');

    expect(response.status).toBe(204);
    const advertised = (response.headers['access-control-allow-headers'] ?? '')
      .split(',')
      .map((h: string) => h.trim().toLowerCase());
    expect(advertised).toContain('idempotency-key');
  });

  it('advertises every header a controller reads via @Headers(...)', () => {
    // Grows with the API surface: any future `@Headers('x-...')` a browser
    // client needs to send must be added to CORS_ALLOWED_HEADERS or this
    // fails as a reminder to keep the two in step.
    const headersControllersRead = ['Idempotency-Key', 'Authorization'];

    for (const header of headersControllersRead) {
      expect(
        CORS_ALLOWED_HEADERS.some(
          (allowed) => allowed.toLowerCase() === header.toLowerCase(),
        ),
      ).toBe(true);
    }
  });
});

describe('CORS startup log value', () => {
  it('reports none when production has no allowed origins', () => {
    expect(getAllowedOriginsLogValue([], true)).toBe('none');
  });

  it('reports all when a non-production environment has no allowed origins', () => {
    expect(getAllowedOriginsLogValue([], false)).toBe('all');
  });

  it('returns the configured origins when present', () => {
    const origins = ['https://a.example.com'];
    expect(getAllowedOriginsLogValue(origins, true)).toBe(origins);
  });

  it('exposes the request ID header to browser scripts', () => {
    expect(CORS_EXPOSED_HEADERS).toContain('X-Request-ID');
  });
});
