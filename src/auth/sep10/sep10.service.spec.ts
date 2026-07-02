/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Sep10Service } from './sep10.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../../config/config.service';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';
import { createHmac } from 'crypto';

// Mock Stellar SDK
jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    random: jest.fn(),
  },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  TransactionBuilder: jest.fn(),
  WebAuth: {
    buildChallengeTx: jest.fn(),
    readChallengeTx: jest.fn(),
    verifyChallengeTxSigners: jest.fn(),
  },
}));

describe('Sep10Service', () => {
  let service: Sep10Service;
  let prisma: PrismaService;
  let configService: ConfigService;
  let mockServerKeypair: any;
  let mockClientKeypair: any;

  const TEST_ACCOUNT_ID = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const SERVER_PUBLIC_KEY = 'GAQAA5L65LSYH7CQ3LBOPEZBWSK4DPO4KZ4XXJNWUVOK5SDGA5LNLA36';
  const TEST_CHALLENGE_XDR = 'AAAABWw2D0wENyMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const TEST_TX_HASH = 'abc123def456abc789def012abc345def678abc901def234abc567abc890def';
  const REFRESH_TOKEN_TTL = 604800; // 7 days in seconds

  beforeEach(async () => {
    // Mock Keypair
    mockServerKeypair = {
      publicKey: jest.fn().mockReturnValue(SERVER_PUBLIC_KEY),
      sign: jest.fn(),
    };

    mockClientKeypair = {
      publicKey: jest.fn().mockReturnValue(TEST_ACCOUNT_ID),
      sign: jest.fn(),
    };

    (Keypair.random as jest.Mock).mockReturnValue(mockServerKeypair);

    // Mock TransactionBuilder
    const mockTransactionBuilder = {
      hash: jest.fn().mockReturnValue({ toString: () => TEST_TX_HASH }),
    };

    (TransactionBuilder as unknown as jest.Mock).mockImplementation(() => mockTransactionBuilder);
    (TransactionBuilder.fromXDR as jest.Mock) = jest.fn().mockReturnValue(mockTransactionBuilder);

    // Mock WebAuth methods
    (WebAuth.buildChallengeTx as jest.Mock).mockReturnValue(TEST_CHALLENGE_XDR);
    (WebAuth.readChallengeTx as jest.Mock).mockReturnValue({
      clientAccountID: TEST_ACCOUNT_ID,
    });
    (WebAuth.verifyChallengeTxSigners as jest.Mock).mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Sep10Service,
        {
          provide: PrismaService,
          useValue: {
            nonce: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            refreshToken: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const configMap: Record<string, any> = {
                STELLAR_NETWORK: 'TESTNET',
                SEP10_JWT_SECRET: 'test-secret-key',
                REFRESH_TOKEN_TTL: REFRESH_TOKEN_TTL,
                ADMIN_ADDRESS: null,
              };
              return configMap[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<Sep10Service>(Sep10Service);
    prisma = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buildChallenge', () => {
    it('should create a valid challenge transaction and store nonce', async () => {
      const timeout = 300;
      const expiresAtTime = new Date(Date.now() + timeout * 1000);

      (prisma.nonce.create as jest.Mock).mockResolvedValue({
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt: expiresAtTime,
        createdAt: new Date(),
      });

      const result = await service.buildChallenge(TEST_ACCOUNT_ID, timeout);

      expect(result).toBe(TEST_CHALLENGE_XDR);
      expect(WebAuth.buildChallengeTx).toHaveBeenCalledWith(
        mockServerKeypair,
        TEST_ACCOUNT_ID,
        'trust-link.local',
        timeout,
        Networks.TESTNET,
        'trust-link.local',
      );
      expect(prisma.nonce.create).toHaveBeenCalled();

      const createCall = (prisma.nonce.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
      });
      expect(createCall.data.expiresAt).toBeDefined();
    });

    it('should use default timeout of 300 seconds when not specified', async () => {
      (prisma.nonce.create as jest.Mock).mockResolvedValue({
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt: new Date(Date.now() + 300 * 1000),
      });

      await service.buildChallenge(TEST_ACCOUNT_ID);

      expect(WebAuth.buildChallengeTx).toHaveBeenCalledWith(
        mockServerKeypair,
        TEST_ACCOUNT_ID,
        'trust-link.local',
        300,
        Networks.TESTNET,
        'trust-link.local',
      );
    });

    it('should store nonce with correct expiration time', async () => {
      const timeout = 600;
      const beforeTime = Date.now();

      (prisma.nonce.create as jest.Mock).mockResolvedValue({
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt: new Date(Date.now() + timeout * 1000),
      });

      await service.buildChallenge(TEST_ACCOUNT_ID, timeout);

      const createCall = (prisma.nonce.create as jest.Mock).mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt;
      const expectedMin = beforeTime + timeout * 1000 - 1000; // Allow 1 second margin
      const expectedMax = beforeTime + timeout * 1000 + 1000;

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('verifyAndIssueToken', () => {
    it('should verify valid challenge and issue tokens', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000); // 1 hour from now

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (prisma.nonce.update as jest.Mock).mockResolvedValue({
        ...mockNonce,
        used: true,
      });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'refresh-token-id',
        userId: TEST_ACCOUNT_ID,
        tokenHash: 'hash-123',
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000),
        revoked: false,
      });

      const result = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(result.token).toMatch(/^[\w-]*\.[\w-]*\.[\w-]*$/); // JWT format
      expect(result.refreshToken).toBeTruthy();

      expect(prisma.nonce.findUnique).toHaveBeenCalledWith({
        where: { nonce: TEST_TX_HASH },
      });
      expect(prisma.nonce.update).toHaveBeenCalledWith({
        where: { id: 'nonce-id-123' },
        data: { used: true },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when challenge has already been used', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: true, // Already used
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Challenge has already been used'),
      );

      expect(prisma.nonce.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when nonce is expired', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() - 3600 * 1000); // Expired 1 hour ago

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: new Date(now.getTime() - 7200 * 1000), // Created 2 hours ago
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Challenge expired'),
      );

      expect(prisma.nonce.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when signature verification fails', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (WebAuth.verifyChallengeTxSigners as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid signature'),
      );

      expect(prisma.nonce.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when challenge not found', async () => {
      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Challenge not found'),
      );

      expect(prisma.nonce.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when WebAuth.readChallengeTx throws', async () => {
      (WebAuth.readChallengeTx as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid challenge format');
      });

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid challenge format'),
      );

      expect(prisma.nonce.findUnique).not.toHaveBeenCalled();
      expect(prisma.nonce.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should mark nonce as used after successful verification', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (prisma.nonce.update as jest.Mock).mockResolvedValue({
        ...mockNonce,
        used: true,
      });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'refresh-token-id',
        userId: TEST_ACCOUNT_ID,
        tokenHash: 'hash-123',
      });

      await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);

      expect(prisma.nonce.update).toHaveBeenCalledWith({
        where: { id: 'nonce-id-123' },
        data: { used: true },
      });
    });

    it('should handle non-Error exceptions in WebAuth.readChallengeTx', async () => {
      (WebAuth.readChallengeTx as jest.Mock).mockImplementation(() => {
        throw 'Some non-Error exception';
      });

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid challenge'),
      );
    });

    it('should handle non-Error exceptions in WebAuth.verifyChallengeTxSigners', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (WebAuth.verifyChallengeTxSigners as jest.Mock).mockImplementation(() => {
        throw 'Some non-Error exception';
      });

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid client signature'),
      );
    });
  });

  describe('getServerPublicKey', () => {
    it('should return the server public key', () => {
      const publicKey = service.getServerPublicKey();
      expect(publicKey).toBe(SERVER_PUBLIC_KEY);
      expect(mockServerKeypair.publicKey).toHaveBeenCalled();
    });
  });

  describe('getNetworkPassphrase', () => {
    it('should return the network passphrase from config', () => {
      const passphrase = service.getNetworkPassphrase();
      expect(passphrase).toBe(Networks.TESTNET);
    });

    it('should return PUBLIC network when configured for MAINNET', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        const configMap: Record<string, any> = {
          STELLAR_NETWORK: 'MAINNET',
          SEP10_JWT_SECRET: 'test-secret-key',
          REFRESH_TOKEN_TTL: REFRESH_TOKEN_TTL,
          ADMIN_ADDRESS: null,
        };
        return configMap[key];
      });

      const newModule: TestingModule = await Test.createTestingModule({
        providers: [
          Sep10Service,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      const newService = newModule.get<Sep10Service>(Sep10Service);
      const passphrase = newService.getNetworkPassphrase();
      expect(passphrase).toBe(Networks.PUBLIC);
    });
  });

  describe('JWT Token Generation', () => {
    it('should generate valid JWT token with correct structure', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (prisma.nonce.update as jest.Mock).mockResolvedValue({
        ...mockNonce,
        used: true,
      });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'refresh-token-id',
        userId: TEST_ACCOUNT_ID,
        tokenHash: 'hash-123',
      });

      const result = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const token = result.token;

      // JWT format: header.payload.signature
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      // Decode header
      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf-8'),
      );
      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');

      // Decode payload
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      expect(payload.sub).toBe(TEST_ACCOUNT_ID);
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('should add admin role to JWT when user is admin', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        const configMap: Record<string, any> = {
          STELLAR_NETWORK: 'TESTNET',
          SEP10_JWT_SECRET: 'test-secret-key',
          REFRESH_TOKEN_TTL: REFRESH_TOKEN_TTL,
          ADMIN_ADDRESS: TEST_ACCOUNT_ID,
        };
        return configMap[key];
      });

      const newModule: TestingModule = await Test.createTestingModule({
        providers: [
          Sep10Service,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      const newService = newModule.get<Sep10Service>(Sep10Service);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);

      const mockNonce = {
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
        walletAddress: TEST_ACCOUNT_ID,
        challenge: TEST_CHALLENGE_XDR,
        used: false,
        expiresAt,
        createdAt: now,
      };

      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (prisma.nonce.update as jest.Mock).mockResolvedValue({
        ...mockNonce,
        used: true,
      });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'refresh-token-id',
        userId: TEST_ACCOUNT_ID,
        tokenHash: 'hash-123',
      });

      const result = await newService.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const token = result.token;

      const parts = token.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      expect(payload.role).toBe('admin');
    });
  });

  describe('JWT Claims and Signature', () => {
    beforeEach(() => {
      const mockNonce = {
        id: 'nonce-id-123',
        used: false,
        expiresAt: new Date(Date.now() + 10000),
      };
      (prisma.nonce.findUnique as jest.Mock).mockResolvedValue(mockNonce);
      (prisma.nonce.update as jest.Mock).mockResolvedValue({
        ...mockNonce,
        used: true,
      });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'rt-id-1',
      });
    });

    it('should include correct sub claim in JWT', async () => {
      const { token } = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const parts = token.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      expect(payload.sub).toBe(TEST_ACCOUNT_ID);
    });

    it('should include valid iat and exp claims in JWT', async () => {
      const beforeIssuance = Math.floor(Date.now() / 1000);
      const { token } = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const afterIssuance = Math.floor(Date.now() / 1000);
      const parts = token.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      expect(payload.iat).toBeGreaterThanOrEqual(beforeIssuance);
      expect(payload.iat).toBeLessThanOrEqual(afterIssuance);
      expect(payload.exp).toBe(payload.iat + 3600); // 1 hour expiry
    });

    it('should generate a token with a signature verifiable by the configured secret', async () => {
      const { token } = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const [header, payload, signature] = token.split('.');

      const expectedSignature = createHmac('sha256', 'test-secret-key')
        .update(`${header}.${payload}`)
        .digest('base64url');

      expect(signature).toBe(expectedSignature);
    });

    it('should have a signature that is invalid when using a different secret', async () => {
      const { token } = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const [header, payload, originalSignature] = token.split('.');

      // Create a signature with a different secret
      const wrongSignature = createHmac('sha256', 'wrong-secret')
        .update(`${header}.${payload}`)
        .digest('base64url');

      expect(wrongSignature).not.toBe(originalSignature);
    });

    it('should ensure exp is always 1 hour after iat', async () => {
      const { token } = await service.verifyAndIssueToken(TEST_CHALLENGE_XDR);
      const parts = token.split('.');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      const tokenExpiryDuration = payload.exp - payload.iat;
      expect(tokenExpiryDuration).toBe(3600); // Exactly 1 hour
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle empty error message from WebAuth.readChallengeTx', async () => {
      (WebAuth.readChallengeTx as jest.Mock).mockImplementation(() => {
        throw new Error('');
      });

      await expect(
        service.verifyAndIssueToken(TEST_CHALLENGE_XDR),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should call TransactionBuilder.fromXDR correctly', async () => {
      const timeout = 300;
      (prisma.nonce.create as jest.Mock).mockResolvedValue({
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
      });

      await service.buildChallenge(TEST_ACCOUNT_ID, timeout);

      expect(TransactionBuilder.fromXDR).toHaveBeenCalledWith(
        TEST_CHALLENGE_XDR,
        Networks.TESTNET,
      );
    });

    it('should properly handle transaction hash computation', async () => {
      (prisma.nonce.create as jest.Mock).mockResolvedValue({
        id: 'nonce-id-123',
        nonce: TEST_TX_HASH,
      });

      await service.buildChallenge(TEST_ACCOUNT_ID);

      const createCall = (prisma.nonce.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.nonce).toBe(TEST_TX_HASH);
    });
  });

  describe('rotateRefreshToken', () => {
    const OLD_REFRESH_TOKEN = 'old-refresh-token-string';
    const TOKEN_HASH = 'hashed-old-token';

    beforeEach(() => {
      // Mock the hashToken private method by spying on it
      jest.spyOn(service as any, 'hashToken').mockReturnValue(TOKEN_HASH);
    });

    it('should rotate a valid refresh token and issue new tokens', async () => {
      const now = new Date();
      const storedToken = {
        id: 'rt-id-1',
        userId: TEST_ACCOUNT_ID,
        tokenHash: TOKEN_HASH,
        revoked: false,
        expiresAt: new Date(now.getTime() + 1000 * 60 * 60), // expires in 1 hour
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);
      (prisma.refreshToken.update as jest.Mock).mockResolvedValue({ ...storedToken, revoked: true });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'rt-id-2',
        userId: TEST_ACCOUNT_ID,
        tokenHash: 'new-hash',
        parentTokenId: 'rt-id-1',
      });

      const result = await service.rotateRefreshToken(OLD_REFRESH_TOKEN);

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: TOKEN_HASH } });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: storedToken.id },
        data: { revoked: true },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for an invalid refresh token', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.rotateRefreshToken(OLD_REFRESH_TOKEN)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
    });

    it('should throw UnauthorizedException for an expired refresh token', async () => {
      const now = new Date();
      const storedToken = {
        id: 'rt-id-1',
        userId: TEST_ACCOUNT_ID,
        tokenHash: TOKEN_HASH,
        revoked: false,
        expiresAt: new Date(now.getTime() - 1000 * 60), // expired 1 minute ago
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);

      await expect(service.rotateRefreshToken(OLD_REFRESH_TOKEN)).rejects.toThrow(
        new UnauthorizedException('Refresh token expired'),
      );
    });

    it('should throw UnauthorizedException and revoke family on revoked token reuse', async () => {
      const now = new Date();
      const storedToken = {
        id: 'rt-id-1',
        userId: TEST_ACCOUNT_ID,
        tokenHash: TOKEN_HASH,
        revoked: true, // Already revoked
        expiresAt: new Date(now.getTime() + 1000 * 60 * 60),
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValueOnce(storedToken); // For findUnique in revokeTokenFamily

      await expect(service.rotateRefreshToken(OLD_REFRESH_TOKEN)).rejects.toThrow(
        new UnauthorizedException('Refresh token reuse detected. All sessions revoked.'),
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: storedToken.userId },
        data: { revoked: true },
      });
    });

    it('should create a new refresh token with a parent ID', async () => {
      const now = new Date();
      const storedToken = {
        id: 'rt-id-1',
        userId: TEST_ACCOUNT_ID,
        tokenHash: TOKEN_HASH,
        revoked: false,
        expiresAt: new Date(now.getTime() + 1000 * 60 * 60),
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);
      (prisma.refreshToken.update as jest.Mock).mockResolvedValue({ ...storedToken, revoked: true });
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'rt-id-2',
        userId: TEST_ACCOUNT_ID,
        tokenHash: 'new-hash',
        parentTokenId: 'rt-id-1',
      });

      await service.rotateRefreshToken(OLD_REFRESH_TOKEN);

      const createCall = (prisma.refreshToken.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.parentTokenId).toBe(storedToken.id);
    });

    it('should log a warning when a revoked token is reused', async () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
      const now = new Date();
      const storedToken = {
        id: 'rt-id-1',
        userId: TEST_ACCOUNT_ID,
        tokenHash: TOKEN_HASH,
        revoked: true,
        expiresAt: new Date(now.getTime() + 1000 * 60 * 60),
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);

      await expect(service.rotateRefreshToken(OLD_REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        `Reuse of revoked refresh token detected for user ${storedToken.userId}`,
      );
    });

    it('should not revoke token family if stored token is not found in revokeTokenFamily', async () => {
      const now = new Date();
      const storedToken = {
        id: 'rt-id-1',
        userId: TEST_ACCOUNT_ID,
        tokenHash: TOKEN_HASH,
        revoked: true,
        expiresAt: new Date(now.getTime() + 1000 * 60 * 60),
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValueOnce(storedToken).mockResolvedValueOnce(null);

      await expect(service.rotateRefreshToken(OLD_REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('hashToken', () => {
    it('should produce a consistent SHA-256 hash for the same input', () => {
      const token = 'my-secret-refresh-token';
      const hash1 = (service as any).hashToken(token);
      const hash2 = (service as any).hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toBe('6a79803b6781e7a9487b493eca2f424d569d72d20a4b5764fa932f4b0633622d');
    });

    it('should produce a different hash for a different input', () => {
      const token1 = 'my-secret-refresh-token';
      const token2 = 'my-other-secret-refresh-token';
      const hash1 = (service as any).hashToken(token1);
      const hash2 = (service as any).hashToken(token2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
