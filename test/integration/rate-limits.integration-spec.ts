import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Route limits must hold against the real AppModule. A spec that builds its
 * own ThrottlerModule can register names the app never registers, and would
 * pass while every route-level limit is silently ignored.
 */
describe('Route-level rate limits (AppModule)', () => {
  let app: INestApplication;
  const ACCOUNT = 'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';

  jest.setTimeout(60000);

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('limits the SEP-10 challenge to AUTH_CHALLENGE_LIMIT per window', async () => {
    const limit = Number(process.env.AUTH_CHALLENGE_LIMIT ?? 10);
    const statuses: number[] = [];
    for (let i = 0; i <= limit; i++) {
      const res = await request(app.getHttpServer()).get(
        `/auth?account=${ACCOUNT}`,
      );
      statuses.push(res.status);
    }

    expect(statuses.slice(0, limit).every((s) => s !== 429)).toBe(true);
    expect(statuses[limit]).toBe(429);
  });

  it('never throttles GET /health', async () => {
    const defaultLimit = Number(process.env.PUBLIC_LIMIT ?? 60);
    for (let i = 0; i <= defaultLimit + 5; i++) {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).not.toBe(429);
    }
  });
});
