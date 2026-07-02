/**
 * Cross-vendor escrow access — integration test.
 *
 * Verifies that:
 * - Vendors cannot access escrows belonging to other vendors
 * - Non-owner requests return 403 Forbidden
 * - Admin users can bypass ownership checks
 */
import crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { EscrowController } from '../../src/escrow/escrow.controller';
import { EscrowService } from '../../src/escrow/escrow.service';
import { BuyerDisputeService } from '../../src/escrow/buyer-dispute.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { S3PresignService } from '../../src/common/services/s3-presign.service';
import { ContractService } from '../../src/stellar/contract.service';
import { CacheService } from '../../src/common/cache.service';

describe('Cross-vendor escrow access (issue #272)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_A = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const VENDOR_B = 'GCCR1DHTVH6M4YJ3KJ5QJ5QJ5QJ5QJ5QJ5QJ5QJ5QJ5QJ5QJ5QJ5Q';
  const ADMIN_ADDRESS = 'GADMIN1234567890123456789012345678901234567890123456';

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'STELLAR_NETWORK':
            return 'TESTNET';
          case 'ADMIN_ADDRESS':
            return ADMIN_ADDRESS;
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    prisma = new PrismaService();

    const mockNotificationsService = {
      notifyFunded: jest.fn(),
      notifyShipped: jest.fn(),
      notifyCompleted: jest.fn(),
      notifyDisputed: jest.fn(),
    } as unknown as NotificationsService;

    const mockEscrowRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByVendorAndItem: jest.fn(),
      findVendorEscrows: jest.fn(),
      findEvents: jest.fn(),
      markShipped: jest.fn(),
      markCancelled: jest.fn(),
      markCompleted: jest.fn(),
      markAutoReleaseCompleted: jest.fn(),
      updateState: jest.fn(),
      saveBuyerContact: jest.fn(),
    } as unknown as EscrowRepository;

    const mockS3PresignService = {
      presign: jest.fn(),
    } as unknown as S3PresignService;

    const mockContractService = {
      getEscrowState: jest.fn(),
      cancelEscrowOnChain: jest.fn(),
    } as unknown as ContractService;

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
    } as unknown as CacheService;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        EscrowService,
        BuyerDisputeService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: EscrowRepository, useValue: mockEscrowRepository },
        { provide: S3PresignService, useValue: mockS3PresignService },
        { provide: ContractService, useValue: mockContractService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await prisma.reset();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  describe('vendor ownership check', () => {
    it('returns 403 when vendor A tries to ship vendor B escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          id: 'escrow-1',
          itemName: 'Test Item',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-address',
          vendorAddress: VENDOR_B,
          state: 'FUNDED',
        },
      });

      const jwtToken = createJwtToken(VENDOR_A);

      await request(app.getHttpServer())
        .patch(`/escrow/${escrow.id}/ship`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ trackingId: 'TRACK123' })
        .expect(403);
    });

    it('returns 403 when vendor A tries to cancel vendor B escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          id: 'escrow-2',
          itemName: 'Test Item',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-address',
          vendorAddress: VENDOR_B,
          state: 'FUNDED',
        },
      });

      const jwtToken = createJwtToken(VENDOR_A);

      await request(app.getHttpServer())
        .patch(`/escrow/${escrow.id}/cancel`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('returns 403 when vendor A tries to delete vendor B escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          id: 'escrow-3',
          itemName: 'Test Item',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-address',
          vendorAddress: VENDOR_B,
          state: 'CREATED',
        },
      });

      const jwtToken = createJwtToken(VENDOR_A);

      await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });
  });

  describe('admin bypass', () => {
    it('allows admin to ship any escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          id: 'escrow-4',
          itemName: 'Test Item',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-address',
          vendorAddress: VENDOR_A,
          state: 'FUNDED',
        },
      });

      const adminToken = createJwtToken(ADMIN_ADDRESS, 'admin');

      await request(app.getHttpServer())
        .patch(`/escrow/${escrow.id}/ship`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ trackingId: 'TRACK456' })
        .expect(200);
    });

    it('allows admin to cancel any escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          id: 'escrow-5',
          itemName: 'Test Item',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-address',
          vendorAddress: VENDOR_A,
          state: 'FUNDED',
        },
      });

      const adminToken = createJwtToken(ADMIN_ADDRESS, 'admin');

      await request(app.getHttpServer())
        .patch(`/escrow/${escrow.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('allows admin to delete any escrow', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          id: 'escrow-6',
          itemName: 'Test Item',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-address',
          vendorAddress: VENDOR_A,
          state: 'CREATED',
        },
      });

      const adminToken = createJwtToken(ADMIN_ADDRESS, 'admin');

      await request(app.getHttpServer())
        .delete(`/escrow/${escrow.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});

function createJwtToken(address: string, role?: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');

  const payload: Record<string, unknown> = {
    sub: address,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  if (role) {
    payload.role = role;
  }

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = 'integration-test-secret-key-for-jwt-32chars';
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${sig}`;
}
