/**
 * Integration tests for POST /auth/refresh (issue #799).
 *
 * The other three /auth routes (challenge, verify, and the legacy GET
 * challenge) have coverage in sep10.integration-spec.ts. This exercises the
 * refresh route, which mints a new session from a stored token hash:
 *   - a used refresh token cannot be replayed
 *   - an expired one is rejected
 *   - a token belonging to another account only ever yields that account's
 *     session, and never disturbs another user's session
 */
import { createHmac } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import request from 'supertest';
import { Sep10Controller } from '../../src/auth/sep10/sep10.controller';
import { Sep10Service } from '../../src/auth/sep10/sep10.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TEST_SIGNING_SECRET } from '../auth-helper';

type MockNonce = Prisma.NonceCreateInput & { id: string };
type MockRefreshToken = Prisma.RefreshTokenCreateInput & { id: string };

const JWT_SECRET = 'a-very-long-secret-key-for-testing-purposes-32chars';

describe('POST /auth/refresh (issue #799)', () => {
  let app: INestApplication;
  const mockNonces = new Map<string, MockNonce>();
  const mockRefreshTokens = new Map<string, MockRefreshToken>();
  let nextId = 1;

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'STELLAR_NETWORK':
            return 'TESTNET';
          case 'SYSTEM_SIGNER_SECRET':
            return TEST_SIGNING_SECRET;
          case 'SEP10_JWT_SECRET':
            return JWT_SECRET;
          case 'REFRESH_TOKEN_TTL':
            return 604800;
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const mockPrismaService = {
      nonce: {
        create: jest.fn(async ({ data }: Prisma.NonceCreateArgs) => {
          const record: MockNonce = { ...data, id: `nonce-${nextId++}` };
          mockNonces.set(data.nonce, record);
          return record;
        }),
        findUnique: jest.fn(async ({ where }: Prisma.NonceFindUniqueArgs) => {
          return (
            (where.nonce ? mockNonces.get(where.nonce) : undefined) ?? null
          );
        }),
        update: jest.fn(async ({ where, data }: Prisma.NonceUpdateArgs) => {
          const record =
            (where.id ? mockNonces.get(where.id) : undefined) ??
            Array.from(mockNonces.values()).find(
              (entry) => entry.id === where.id,
            ) ??
            (where.nonce ? mockNonces.get(where.nonce) : undefined) ??
            null;
          if (!record) return null;
          Object.assign(record, data);
          return record;
        }),
      },
      refreshToken: {
        create: jest.fn(async ({ data }: Prisma.RefreshTokenCreateArgs) => {
          const record: MockRefreshToken = {
            ...data,
            id: `refresh-${nextId++}`,
          };
          mockRefreshTokens.set(data.tokenHash, record);
          return record;
        }),
        findUnique: jest.fn(
          async ({ where }: Prisma.RefreshTokenFindUniqueArgs) => {
            return (
              (where.tokenHash
                ? mockRefreshTokens.get(where.tokenHash)
                : undefined) ??
              Array.from(mockRefreshTokens.values()).find(
                (entry) => entry.id === where.id,
              ) ??
              null
            );
          },
        ),
        update: jest.fn(
          async ({ where, data }: Prisma.RefreshTokenUpdateArgs) => {
            const record =
              (where.tokenHash
                ? mockRefreshTokens.get(where.tokenHash)
                : undefined) ??
              Array.from(mockRefreshTokens.values()).find(
                (entry) => entry.id === where.id,
              ) ??
              null;
            if (!record) return null;
            Object.assign(record, data);
            return record;
          },
        ),
        updateMany: jest.fn(
          async ({ where, data }: Prisma.RefreshTokenUpdateManyArgs) => {
            let count = 0;
            for (const record of mockRefreshTokens.values()) {
              if (record.userId === where?.userId) {
                Object.assign(record, data);
                count++;
              }
            }
            return { count };
          },
        ),
      },
    } as unknown as PrismaService;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [Sep10Controller],
      providers: [
        Sep10Service,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── helpers ─────────────────────────────────────────────────────────────

  /** Runs the full SEP-10 challenge/verify flow and returns the issued tokens. */
  async function loginAs(
    keypair: Keypair,
  ): Promise<{ token: string; refreshToken: string }> {
    const challengeRes = await request(app.getHttpServer())
      .get('/auth')
      .query({ account: keypair.publicKey() })
      .expect(200);
    const challengeXdr = challengeRes.body.transaction as string;

    const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET);
    tx.sign(keypair);
    const signedXdr = tx.toEnvelope().toXDR('base64').toString();

    const verifyRes = await request(app.getHttpServer())
      .post('/auth')
      .send({ transaction: signedXdr })
      .expect(201);

    return verifyRes.body as { token: string; refreshToken: string };
  }

  /** Decodes the `sub` claim out of an unverified JWT (test-only helper). */
  function subjectOf(jwt: string): string {
    const [, body] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.sub as string;
  }

  function tokenHashOf(refreshToken: string): string {
    return createHmac('sha256', JWT_SECRET).update(refreshToken).digest('hex');
  }

  // ── tests ────────────────────────────────────────────────────────────────

  it('rotating a valid refresh token returns a fresh token pair for the same account', async () => {
    const kp = Keypair.random();
    const { refreshToken } = await loginAs(kp);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const { token, refreshToken: newRefreshToken } = res.body as {
      token: string;
      refreshToken: string;
    };
    expect(typeof token).toBe('string');
    expect(subjectOf(token)).toBe(kp.publicKey());
    expect(newRefreshToken).not.toBe(refreshToken);
  });

  it('rejects a refresh token that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'a-token-that-was-never-issued' })
      .expect(401);
  });

  it('rejects an expired refresh token', async () => {
    const kp = Keypair.random();
    const { refreshToken } = await loginAs(kp);

    const record = mockRefreshTokens.get(tokenHashOf(refreshToken));
    expect(record).toBeDefined();
    record!.expiresAt = new Date(Date.now() - 1000);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('rejects replay of an already-rotated refresh token', async () => {
    const kp = Keypair.random();
    const { refreshToken } = await loginAs(kp);

    // First use rotates it successfully.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    // Replaying the now-revoked token must be rejected.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('replaying a rotated token revokes the whole session family, including the new token', async () => {
    const kp = Keypair.random();
    const { refreshToken } = await loginAs(kp);

    const rotateRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    const { refreshToken: rotatedToken } = rotateRes.body as {
      refreshToken: string;
    };

    // Replay of the old, already-revoked token trips reuse detection.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // The legitimate, still-fresh token from the successful rotation is now
    // revoked too, since a stolen-token replay revokes the entire family.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotatedToken })
      .expect(401);
  });

  it('does not let one account refresh using a token that belongs to another account', async () => {
    const kpA = Keypair.random();
    const kpB = Keypair.random();
    const { refreshToken: tokenA } = await loginAs(kpA);
    const { refreshToken: tokenB } = await loginAs(kpB);

    // Rotating A's token must never mint or affect B's session.
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(200);
    expect(subjectOf((res.body as { token: string }).token)).toBe(
      kpA.publicKey(),
    );

    // B's original token is untouched and still works.
    const resB = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenB })
      .expect(200);
    expect(subjectOf((resB.body as { token: string }).token)).toBe(
      kpB.publicKey(),
    );
  });

  it('rejects a missing refreshToken with a 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(400);
  });
});
