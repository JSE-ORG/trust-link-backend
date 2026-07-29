/**
 * SEP-10 nonce cleanup — integration test.
 *
 * Verifies that the cleanup job:
 * - Removes expired nonces
 * - Preserves active nonces
 * - Runs without errors on empty table
 *
 * Issue #501: this used to exercise `Sep10Service.cleanupExpiredNonces`, which
 * duplicated `NonceCleanupService` on the same `@Cron('0 0 * * *')` schedule
 * against the same table. `NonceCleanupService` is now the single cleanup
 * path, so the test exercises it directly.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NonceCleanupService } from '../../src/auth/sep10/nonce-cleanup.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Nonce cleanup integration (issue #274, #501)', () => {
  let app: INestApplication;
  let nonceCleanupService: NonceCleanupService;
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        NonceCleanupService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    nonceCleanupService = moduleFixture.get(NonceCleanupService);
  });

  afterAll(async () => {
    await prisma.reset();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  it('removes expired nonces while preserving active ones', async () => {
    const pastDate = new Date(Date.now() - 10000);
    const futureDate = new Date(Date.now() + 60000);

    await prisma.nonce.create({
      data: {
        nonce: 'expired-1',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-expired-1',
        used: false,
        expiresAt: pastDate,
      },
    });

    await prisma.nonce.create({
      data: {
        nonce: 'expired-2',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-expired-2',
        used: true,
        expiresAt: pastDate,
      },
    });

    await prisma.nonce.create({
      data: {
        nonce: 'active-1',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-active-1',
        used: false,
        expiresAt: futureDate,
      },
    });

    await nonceCleanupService.cleanupExpiredNonces();

    const expired1 = await prisma.nonce.findUnique({
      where: { nonce: 'expired-1' },
    });
    const expired2 = await prisma.nonce.findUnique({
      where: { nonce: 'expired-2' },
    });
    const active1 = await prisma.nonce.findUnique({
      where: { nonce: 'active-1' },
    });

    expect(expired1).toBeNull();
    expect(expired2).toBeNull();
    expect(active1).not.toBeNull();
    expect(active1?.nonce).toBe('active-1');
  });

  it('handles empty nonce table', async () => {
    await expect(
      nonceCleanupService.cleanupExpiredNonces(),
    ).resolves.not.toThrow();
  });

  it('does not affect nonces that expire exactly at now', async () => {
    const now = new Date(Date.now() + 100);

    await prisma.nonce.create({
      data: {
        nonce: 'expires-now',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-expires-now',
        used: false,
        expiresAt: now,
      },
    });

    await nonceCleanupService.cleanupExpiredNonces();

    const nonce = await prisma.nonce.findUnique({
      where: { nonce: 'expires-now' },
    });
    expect(nonce).not.toBeNull();
  });
});
