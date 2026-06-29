import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';

describe('Stress test endpoint auth guards', () => {
  let app: INestApplication;
  let configService: ConfigService;
  let jwtSecret: string;
  let adminAddress: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    configService = app.get(ConfigService);
    jwtSecret = configService.get('SEP10_JWT_SECRET');
    adminAddress = configService.get('ADMIN_ADDRESS');
  });

  afterAll(async () => {
    await app?.close();
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

  it('returns 401 for unauthenticated POST /stress-test requests', async () => {
    await request(app.getHttpServer())
      .post('/stress-test')
      .send({ testName: 'auth guard test' })
      .expect(401);
  });

  it('returns 403 for non-admin JWT POST /stress-test requests', async () => {
    await request(app.getHttpServer())
      .post('/stress-test')
      .set('Authorization', `Bearer ${vendorJwt()}`)
      .send({ testName: 'auth guard test' })
      .expect(403);
  });

  it('returns 401 for unauthenticated GET /stress-test/active requests', async () => {
    await request(app.getHttpServer()).get('/stress-test/active').expect(401);
  });

  it('returns 403 for non-admin JWT GET /stress-test/active requests', async () => {
    await request(app.getHttpServer())
      .get('/stress-test/active')
      .set('Authorization', `Bearer ${vendorJwt()}`)
      .expect(403);
  });

  it('allows admin JWT requests to reach the controller', async () => {
    await request(app.getHttpServer())
      .get('/stress-test/active')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .expect(200);
  });
});
