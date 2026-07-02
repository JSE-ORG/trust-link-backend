/**
 * SEP-10 nonce cleanup — integration test.
 *
 * Verifies that the cleanup job:
 * - Removes expired nonces
 * - Preserves active nonces
 * - Runs without errors on empty table
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Sep10Service } from '../../src/auth/sep10/sep10.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Nonce cleanup integration (issue #274)', () => {
  let app: INestApplication;
  let sep10Service: Sep10Service;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'STELLAR_NETWORK':
            return 'TESTNET';
          case 'SEP10_JWT_SECRET':
            return 'integration-test-secret-key-for-jwt-32chars';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    prisma = new PrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        Sep10Service,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    sep10Service = moduleFixture.get(Sep10Service);
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

    await sep10Service.cleanupExpiredNonces();

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
    await expect(sep10Service.cleanupExpiredNonces()).resolves.not.toThrow();
  });

  it('does not affect nonces that expire exactly at now', async () => {
    const now = new Date();

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

    await sep10Service.cleanupExpiredNonces();

    const nonce = await prisma.nonce.findUnique({
      where: { nonce: 'expires-now' },
    });
    expect(nonce).not.toBeNull();
  });
});
