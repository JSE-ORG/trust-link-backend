/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Standard error response format (issue #235)', () => {
  let app: INestApplication;

  const expectStandardError = (
    body: Record<string, unknown>,
    statusCode: number,
    path: string,
  ): void => {
    expect(body).toEqual(
      expect.objectContaining({
        statusCode,
        message: expect.anything(),
        error: expect.any(String),
        timestamp: expect.any(String),
        path,
        requestId: expect.any(String),
      }),
    );
    expect(new Date(body.timestamp as string).toISOString()).toBe(
      body.timestamp,
    );
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses the standard envelope for not-found routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/missing-route')
      .set('x-request-id', 'req-error-format-404')
      .expect(404);

    expectStandardError(res.body, 404, '/missing-route');
    expect(res.body.requestId).toBe('req-error-format-404');
  });

  it('uses the standard envelope for validation errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/challenge')
      .send({})
      .expect(400);

    expectStandardError(res.body, 400, '/auth/challenge');
  });

  it('uses the standard envelope for unauthorized protected endpoints', async () => {
    const res = await request(app.getHttpServer())
      .get('/vendor/profile')
      .expect(401);

    expectStandardError(res.body, 401, '/vendor/profile');
  });
});
