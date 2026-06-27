import { Test, TestingModule } from '@nestjs/testing';
import { NonceCleanupService } from '../../src/auth/sep10/nonce-cleanup.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('NonceCleanupService', () => {
  let service: NonceCleanupService;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NonceCleanupService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NonceCleanupService>(NonceCleanupService);
  });

  afterEach(async () => {
    await prisma.reset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanupExpiredNonces', () => {
    it('should delete expired nonces', async () => {
      const now = new Date();

      await prisma.nonce.create({
        data: {
          nonce: 'expired-nonce-1',
          walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          challenge: 'challenge-1',
          used: false,
          expiresAt: new Date(now.getTime() - 1000),
        },
      });

      await prisma.nonce.create({
        data: {
          nonce: 'expired-nonce-2',
          walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          challenge: 'challenge-2',
          used: false,
          expiresAt: new Date(now.getTime() - 2000),
        },
      });

      await service.cleanupExpiredNonces();

      const remaining = await prisma.nonce.findUnique({
        where: { nonce: 'expired-nonce-1' },
      });

      expect(remaining).toBeNull();
    });

    it('should not delete active nonces', async () => {
      const now = new Date();

      await prisma.nonce.create({
        data: {
          nonce: 'active-nonce',
          walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          challenge: 'challenge-active',
          used: false,
          expiresAt: new Date(now.getTime() + 60000),
        },
      });

      await service.cleanupExpiredNonces();

      const remaining = await prisma.nonce.findUnique({
        where: { nonce: 'active-nonce' },
      });

      expect(remaining).not.toBeNull();
    });

    it('should delete only expired nonces and keep active ones', async () => {
      const now = new Date();

      await prisma.nonce.create({
        data: {
          nonce: 'expired-nonce',
          walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          challenge: 'challenge-expired',
          used: false,
          expiresAt: new Date(now.getTime() - 1000),
        },
      });

      await prisma.nonce.create({
        data: {
          nonce: 'active-nonce',
          walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          challenge: 'challenge-active',
          used: false,
          expiresAt: new Date(now.getTime() + 60000),
        },
      });

      await service.cleanupExpiredNonces();

      const expired = await prisma.nonce.findUnique({
        where: { nonce: 'expired-nonce' },
      });
      const active = await prisma.nonce.findUnique({
        where: { nonce: 'active-nonce' },
      });

      expect(expired).toBeNull();
      expect(active).not.toBeNull();
    });

    it('should handle empty nonce table gracefully', async () => {
      await expect(service.cleanupExpiredNonces()).resolves.not.toThrow();
    });
  });
});
