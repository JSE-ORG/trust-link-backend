import { Test } from '@nestjs/testing';
import { Sep10Service } from '../../src/auth/sep10/sep10.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Sep10Service nonce cleanup (issue #274)', () => {
  let service: Sep10Service;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();

    const mockConfigService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'STELLAR_NETWORK':
            return 'TESTNET';
          case 'SEP10_JWT_SECRET':
            return 'test-secret-key-for-hmac-signing';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        Sep10Service,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(Sep10Service);
  });

  afterEach(async () => {
    await prisma.reset();
  });

  it('removes expired nonces from the database', async () => {
    const pastDate = new Date(Date.now() - 10000);
    const futureDate = new Date(Date.now() + 60000);

    await prisma.nonce.create({
      data: {
        nonce: 'expired-nonce-1',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-1',
        used: false,
        expiresAt: pastDate,
      },
    });

    await prisma.nonce.create({
      data: {
        nonce: 'expired-nonce-2',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-2',
        used: true,
        expiresAt: pastDate,
      },
    });

    await prisma.nonce.create({
      data: {
        nonce: 'active-nonce',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-3',
        used: false,
        expiresAt: futureDate,
      },
    });

    await service.cleanupExpiredNonces();

    const remaining = await prisma.nonce.findUnique({
      where: { nonce: 'active-nonce' },
    });

    expect(remaining).not.toBeNull();
    expect(remaining?.nonce).toBe('active-nonce');

    const expired1 = await prisma.nonce.findUnique({
      where: { nonce: 'expired-nonce-1' },
    });
    const expired2 = await prisma.nonce.findUnique({
      where: { nonce: 'expired-nonce-2' },
    });

    expect(expired1).toBeNull();
    expect(expired2).toBeNull();
  });

  it('does not remove active nonces', async () => {
    const futureDate = new Date(Date.now() + 60000);

    await prisma.nonce.create({
      data: {
        nonce: 'active-nonce-1',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-1',
        used: false,
        expiresAt: futureDate,
      },
    });

    await prisma.nonce.create({
      data: {
        nonce: 'active-nonce-2',
        walletAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        challenge: 'challenge-xdr-2',
        used: false,
        expiresAt: futureDate,
      },
    });

    await service.cleanupExpiredNonces();

    const nonce1 = await prisma.nonce.findUnique({
      where: { nonce: 'active-nonce-1' },
    });
    const nonce2 = await prisma.nonce.findUnique({
      where: { nonce: 'active-nonce-2' },
    });

    expect(nonce1).not.toBeNull();
    expect(nonce2).not.toBeNull();
  });

  it('handles empty nonce table gracefully', async () => {
    await expect(service.cleanupExpiredNonces()).resolves.not.toThrow();
  });
});
