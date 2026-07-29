import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * Issue: CORS origin callback threw an Error for disallowed origins, causing a
 * 500 response. The correct convention is callback(null, false), which omits
 * the Access-Control-Allow-Origin header and lets the browser block the request.
 *
 * Tests cover allowed, disallowed, and absent-origin requests.
 */
@Controller('health')
class FixtureHealthController {
  @Get()
  check() {
    return { ok: true };
  }
}

const ALLOWED_ORIGIN = 'https://app.trust-link.io';
const DISALLOWED_ORIGIN = 'https://evil.example.com';

describe('CORS origin callback (disallowed origin → clean denial)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FixtureHealthController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if ([ALLOWED_ORIGIN].includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'Idempotency-Key',
      ],
      credentials: true,
      maxAge: 86400,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a request from an allowed origin (includes ACAO header)', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN);

    expect(response.status).not.toBe(500);
    expect(response.headers['access-control-allow-origin']).toBe(
      ALLOWED_ORIGIN,
    );
  });

  it('denies a request from a disallowed origin (no ACAO header, no 5xx)', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', DISALLOWED_ORIGIN);

    expect(response.status).not.toBe(500);
    expect(
      response.headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('allows a request with no Origin header (non-browser clients)', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('preflight for an allowed origin advertises Idempotency-Key', async () => {
    const response = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    const advertised = (
      response.headers['access-control-allow-headers'] ?? ''
    )
      .split(',')
      .map((h: string) => h.trim().toLowerCase());
    expect(advertised).toContain('idempotency-key');
  });

  it('preflight for a disallowed origin omits ACAO header', async () => {
    const response = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', DISALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).not.toBe(500);
    expect(
      response.headers['access-control-allow-origin'],
    ).toBeUndefined();
  });
});
