import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Sep10Service } from './sep10.service';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';

type RefreshTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  parentTokenId: string | null;
  expiresAt: Date;
  revoked: boolean;
};

function buildModule(
  configMap: Record<string, unknown>,
  prismaOverrides: Record<string, unknown> = {},
): Promise<TestingModule> {
  const configService = {
    get: <T = unknown>(key: string): T | undefined =>
      configMap[key] as T | undefined,
  };

  const prismaService = {
    nonce: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    ...prismaOverrides,
  };

  return Test.createTestingModule({
    providers: [
      Sep10Service,
      { provide: ConfigService, useValue: configService },
      { provide: PrismaService, useValue: prismaService },
    ],
  }).compile();
}

describe('Sep10Service', () => {
  describe('SEP10_JWT_SECRET fallback removed (#283)', () => {
    it('throws instead of falling back to the literal "secret" when missing', async () => {
      const moduleRef = await buildModule({});
      const service = moduleRef.get(Sep10Service);

      // hashToken is private; invoke through the public surface that depends on it.
      // rotateRefreshToken hashes the incoming token before any DB call, so an
      // unset secret must throw here before reaching prisma.
      await expect(service.rotateRefreshToken('any-token')).rejects.toThrow(
        /SEP10_JWT_SECRET is not set/,
      );
    });

    it('throws when SEP10_JWT_SECRET is an empty string', async () => {
      const moduleRef = await buildModule({ SEP10_JWT_SECRET: '' });
      const service = moduleRef.get(Sep10Service);

      await expect(service.rotateRefreshToken('any-token')).rejects.toThrow(
        /SEP10_JWT_SECRET is not set/,
      );
    });
  });

  describe('rotateRefreshToken (#281)', () => {
    const validSecret = 'x'.repeat(32);

    function makeStoredToken(
      overrides: Partial<RefreshTokenRecord> = {},
    ): RefreshTokenRecord {
      return {
        id: 'token-id-1',
        userId: 'user-1',
        tokenHash: 'pre-computed-hash',
        parentTokenId: null,
        expiresAt: new Date(Date.now() + 60_000),
        revoked: false,
        ...overrides,
      };
    }

    async function setup(stored: RefreshTokenRecord | null) {
      const prismaOverrides = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(stored),
          update: jest.fn().mockResolvedValue(stored),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: 'new-token-id', ...data }),
          ),
        },
      };
      const moduleRef = await buildModule(
        { SEP10_JWT_SECRET: validSecret },
        prismaOverrides,
      );
      return {
        service: moduleRef.get(Sep10Service),
        prisma: moduleRef.get(PrismaService) as unknown as {
          refreshToken: {
            findUnique: jest.Mock;
            update: jest.Mock;
            updateMany: jest.Mock;
            create: jest.Mock;
          };
        },
      };
    }

    it('rotates a valid refresh token, revokes the old one, and issues a new pair', async () => {
      const stored = makeStoredToken();
      const { service, prisma } = await setup(stored);

      const result = await service.rotateRefreshToken('valid-refresh');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: stored.id },
        data: { revoked: true },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('revokes the entire token family when a revoked token is reused', async () => {
      const stored = makeStoredToken({ revoked: true });
      const { service, prisma } = await setup(stored);

      await expect(
        service.rotateRefreshToken('reused-refresh'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: stored.userId },
        data: { revoked: true },
      });
    });

    it('throws UnauthorizedException when the refresh token has expired', async () => {
      const stored = makeStoredToken({
        expiresAt: new Date(Date.now() - 1_000),
      });
      const { service, prisma } = await setup(stored);

      await expect(
        service.rotateRefreshToken('expired-refresh'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the refresh token hash is not found', async () => {
      const { service, prisma } = await setup(null);

      await expect(
        service.rotateRefreshToken('unknown-refresh'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokeTokenFamily revokes every refresh token belonging to the user', async () => {
      const stored = makeStoredToken({ userId: 'user-42' });
      const prismaOverrides = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(stored),
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
          update: jest.fn(),
          create: jest.fn(),
        },
      };
      const moduleRef = await buildModule(
        { SEP10_JWT_SECRET: validSecret },
        prismaOverrides,
      );
      const service = moduleRef.get(Sep10Service);
      const prisma = moduleRef.get(PrismaService) as unknown as {
        refreshToken: { updateMany: jest.Mock };
      };

      await service.revokeTokenFamily(stored.id);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-42' },
        data: { revoked: true },
      });
    });
  });
});
