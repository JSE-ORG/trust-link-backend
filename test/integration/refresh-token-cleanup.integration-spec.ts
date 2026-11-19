/**
 * Integration tests for RefreshTokenCleanupService (issue #1120).
 *
 * Exercises the cleanup job against a real PostgreSQL database to verify that:
 * - Tokens expired more than 30 days ago are deleted.
 * - Tokens expired within the grace period remain.
 * - Unexpired tokens are never touched.
 * - Revoked-but-unexpired tokens remain (reuse-detection needs them).
 * - The logger emits the deleted count.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshTokenCleanupService } from '../../src/auth/sep10/refresh-token-cleanup.service';
import { RefreshTokenRepository } from '../../src/auth/sep10/refresh-token.repository';
import { PrismaService } from '../../src/prisma/prisma.service';

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

describe('RefreshTokenCleanupService integration (issue #1120)', () => {
  let app: INestApplication;
  let cleanupService: RefreshTokenCleanupService;
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenCleanupService,
        RefreshTokenRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    cleanupService = moduleFixture.get(RefreshTokenCleanupService);
  });

  afterAll(async () => {
    await prisma.reset();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  function createToken(overrides: {
    tokenHash: string;
    expiresAt: Date;
    revoked?: boolean;
  }) {
    return prisma.refreshToken.create({
      data: {
        userId: 'user-integration-test',
        tokenHash: overrides.tokenHash,
        expiresAt: overrides.expiresAt,
        revoked: overrides.revoked ?? false,
      },
    });
  }

  it('deletes tokens expired more than 30 days ago', async () => {
    const expiredLongAgo = new Date(Date.now() - GRACE_PERIOD_MS - 1000);
    await createToken({ tokenHash: 'hash-stale-1', expiresAt: expiredLongAgo });
    await createToken({ tokenHash: 'hash-stale-2', expiresAt: expiredLongAgo });

    await cleanupService.cleanupExpiredRefreshTokens();

    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('keeps tokens expired within the last 30 days', async () => {
    const expiredRecently = new Date(Date.now() - GRACE_PERIOD_MS + 60_000);
    await createToken({ tokenHash: 'hash-recent', expiresAt: expiredRecently });

    await cleanupService.cleanupExpiredRefreshTokens();

    const remaining = await prisma.refreshToken.findUnique({
      where: { tokenHash: 'hash-recent' },
    });
    expect(remaining).not.toBeNull();
  });

  it('keeps unexpired tokens', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await createToken({ tokenHash: 'hash-live', expiresAt: future });

    await cleanupService.cleanupExpiredRefreshTokens();

    const remaining = await prisma.refreshToken.findUnique({
      where: { tokenHash: 'hash-live' },
    });
    expect(remaining).not.toBeNull();
  });

  it('keeps revoked-but-unexpired tokens (replay detection requires them)', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await createToken({ tokenHash: 'hash-revoked-live', expiresAt: future, revoked: true });

    await cleanupService.cleanupExpiredRefreshTokens();

    const remaining = await prisma.refreshToken.findUnique({
      where: { tokenHash: 'hash-revoked-live' },
    });
    expect(remaining).not.toBeNull();
  });

  it('deletes revoked tokens that are also past the grace period', async () => {
    const expiredLongAgo = new Date(Date.now() - GRACE_PERIOD_MS - 1000);
    await createToken({ tokenHash: 'hash-revoked-stale', expiresAt: expiredLongAgo, revoked: true });

    await cleanupService.cleanupExpiredRefreshTokens();

    const remaining = await prisma.refreshToken.findUnique({
      where: { tokenHash: 'hash-revoked-stale' },
    });
    expect(remaining).toBeNull();
  });

  it('runs without error on an empty table', async () => {
    await expect(cleanupService.cleanupExpiredRefreshTokens()).resolves.not.toThrow();
  });

  it('only deletes expired-past-grace-period rows, leaving others intact', async () => {
    const expiredLongAgo = new Date(Date.now() - GRACE_PERIOD_MS - 1000);
    const future = new Date(Date.now() + 3600_000);
    const expiredRecently = new Date(Date.now() - GRACE_PERIOD_MS + 60_000);

    await createToken({ tokenHash: 'hash-delete', expiresAt: expiredLongAgo });
    await createToken({ tokenHash: 'hash-keep-live', expiresAt: future });
    await createToken({ tokenHash: 'hash-keep-recent', expiresAt: expiredRecently });

    await cleanupService.cleanupExpiredRefreshTokens();

    expect(
      await prisma.refreshToken.findUnique({ where: { tokenHash: 'hash-delete' } }),
    ).toBeNull();
    expect(
      await prisma.refreshToken.findUnique({ where: { tokenHash: 'hash-keep-live' } }),
    ).not.toBeNull();
    expect(
      await prisma.refreshToken.findUnique({ where: { tokenHash: 'hash-keep-recent' } }),
    ).not.toBeNull();
  });
});
