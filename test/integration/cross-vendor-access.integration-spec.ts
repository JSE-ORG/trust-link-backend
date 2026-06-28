import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { EscrowController } from '../../src/escrow/escrow.controller';
import { EscrowService } from '../../src/escrow/escrow.service';
import { BuyerDisputeService } from '../../src/escrow/buyer-dispute.service';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { AuthUser } from '../../src/auth/auth-user';
import { ForbiddenException } from '@nestjs/common';

describe('Cross-Vendor Escrow Access (issue #272)', () => {
  let app: INestApplication;
  let escrowService: jest.Mocked<EscrowService>;

  const vendorAAddress =
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const vendorBAddress =
    'GCZHXL5F4MTPVHLKQ62S7GQLI6IMTMYXJQWA762E3ROJ5HKMMN576V5F';
  const adminAddress = 'GADMINADDRESS123456789012345678901234567890123456';
  const escrowId = '00000000-0000-0000-0000-000000000001';

  const mockEscrow = {
    id: escrowId,
    itemName: 'Test Item',
    itemRef: 'ref-001',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'GBUYERADDRESS',
    vendorAddress: vendorAAddress,
    state: 'FUNDED' as const,
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    buyerContactEmail: null,
    buyerContactPhone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    escrowService = {
      findById: jest.fn().mockResolvedValue(mockEscrow),
      handleShipment: jest
        .fn()
        .mockResolvedValue({ ...mockEscrow, state: 'SHIPPED' as const }),
      cancelEscrow: jest
        .fn()
        .mockResolvedValue({ ...mockEscrow, state: 'CANCELLED' as const }),
      cancelPendingEscrow: jest
        .fn()
        .mockResolvedValue({ ...mockEscrow, state: 'CANCELLED' as const }),
    } as unknown as jest.Mocked<EscrowService>;

    const mockBuyerDisputeService = {
      openDispute: jest.fn(),
      getDispute: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        { provide: EscrowService, useValue: escrowService },
        { provide: BuyerDisputeService, useValue: mockBuyerDisputeService },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          const authHeader = request.headers.authorization;
          if (!authHeader) return false;

          const token = authHeader.replace('Bearer ', '');
          if (token === 'vendor-a') {
            request.user = { address: vendorAAddress } as AuthUser;
          } else if (token === 'vendor-b') {
            request.user = { address: vendorBAddress } as AuthUser;
          } else if (token === 'admin') {
            request.user = { address: adminAddress, role: 'admin' } as AuthUser;
          }
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ship escrow', () => {
    it('allows vendor to ship their own escrow', async () => {
      escrowService.handleShipment.mockResolvedValueOnce({
        ...mockEscrow,
        state: 'SHIPPED',
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/ship`)
        .set('Authorization', 'Bearer vendor-a')
        .send({ trackingId: 'TRACK123' })
        .expect(200);
    });

    it('returns 403 when cross-vendor tries to ship', async () => {
      escrowService.handleShipment.mockImplementationOnce(() => {
        throw new ForbiddenException(
          'Only the escrow vendor or admin can ship this order',
        );
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/ship`)
        .set('Authorization', 'Bearer vendor-b')
        .send({ trackingId: 'TRACK123' })
        .expect(403);
    });

    it('allows admin to ship any escrow', async () => {
      escrowService.handleShipment.mockResolvedValueOnce({
        ...mockEscrow,
        state: 'SHIPPED',
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/ship`)
        .set('Authorization', 'Bearer admin')
        .send({ trackingId: 'TRACK123' })
        .expect(200);
    });
  });

  describe('cancel escrow', () => {
    it('allows vendor to cancel their own escrow', async () => {
      escrowService.cancelEscrow.mockResolvedValueOnce({
        ...mockEscrow,
        state: 'CANCELLED',
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', 'Bearer vendor-a')
        .expect(200);
    });

    it('returns 403 when cross-vendor tries to cancel', async () => {
      escrowService.cancelEscrow.mockImplementationOnce(() => {
        throw new ForbiddenException(
          'Only the vendor, buyer, or admin can cancel this escrow',
        );
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', 'Bearer vendor-b')
        .expect(403);
    });

    it('allows admin to cancel any escrow', async () => {
      escrowService.cancelEscrow.mockResolvedValueOnce({
        ...mockEscrow,
        state: 'CANCELLED',
      });

      await request(app.getHttpServer())
        .patch(`/escrow/${escrowId}/cancel`)
        .set('Authorization', 'Bearer admin')
        .expect(200);
    });
  });

  describe('delete pending escrow', () => {
    it('allows vendor to delete their own pending escrow', async () => {
      escrowService.cancelPendingEscrow.mockResolvedValueOnce({
        ...mockEscrow,
        state: 'CANCELLED',
      });

      await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', 'Bearer vendor-a')
        .expect(200);
    });

    it('returns 403 when cross-vendor tries to delete', async () => {
      escrowService.cancelPendingEscrow.mockImplementationOnce(() => {
        throw new ForbiddenException(
          'Only the vendor, buyer, or admin can cancel this escrow',
        );
      });

      await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', 'Bearer vendor-b')
        .expect(403);
    });

    it('allows admin to delete any pending escrow', async () => {
      escrowService.cancelPendingEscrow.mockResolvedValueOnce({
        ...mockEscrow,
        state: 'CANCELLED',
      });

      await request(app.getHttpServer())
        .delete(`/escrow/${escrowId}`)
        .set('Authorization', 'Bearer admin')
        .expect(200);
    });
  });
});
