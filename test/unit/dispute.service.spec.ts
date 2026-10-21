import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminGuard } from '../../src/admin/guards/admin.guard';
import { DisputeService } from '../../src/admin/dispute/dispute.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { EscrowRecord } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { DisputeController } from '../../src/admin/dispute/dispute.controller';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { ConfigService } from '../../src/config/config.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { bearer } from '../auth-helper';

// ── shared fixture ────────────────────────────────────────────────────────

const disputedEscrow: EscrowRecord = {
  id: '0f0a3c8e-1f2b-4c3d-9e8f-1a2b3c4d5e6f',
  contractEscrowId: 42n,
  itemName: 'Vintage camera',
  itemRef: 'camera-001',
  amount: 200,
  currency: 'USDC',
  buyerAddress: 'buyer-address',
  vendorAddress: 'vendor-address',
  state: 'DISPUTED',
  trackingId: 'TRK-XYZ',
  shippedAt: new Date('2026-01-01T00:00:00.000Z'),
  deliveredAt: null,
  deliveryRecordedAt: null,
  autoReleaseSubmittedAt: null,
  autoReleaseTxHash: null,
  disputeId: null,
  cancelledAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

// ── service-level unit tests ──────────────────────────────────────────────

describe('DisputeService (issues #25, #924, #925, #926, #927)', () => {
  let service: DisputeService;
  let repository: jest.Mocked<EscrowRepository>;
  let contractService: jest.Mocked<ContractService>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let notificationsService: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      markCompleted: jest.fn(),
      markRefunded: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    contractService = {
      resolveDispute: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    disputeRepository = {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<DisputeRepository>;

    notificationsService = {
      notifyCompleted: jest.fn().mockResolvedValue(undefined),
      notifyRefunded: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputeService,
        { provide: EscrowRepository, useValue: repository },
        { provide: ContractService, useValue: contractService },
        { provide: DisputeRepository, useValue: disputeRepository },
        { provide: NotificationsService, useValue: notificationsService },
        {
          // resolve_dispute require_auth()s the caller, which must be the
          // contract admin, so DisputeService resolves ADMIN_ADDRESS on use.
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            ),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DisputeService);
  });

  it('RELEASE resolution calls contract, marks escrow COMPLETED, and resolves the open dispute', async () => {
    const completed = { ...disputedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(disputedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);
    disputeRepository.findFirst.mockResolvedValue({
      id: 'dispute-1',
      escrowId: disputedEscrow.id,
      status: 'OPEN',
    } as never);

    const result = await service.resolve(disputedEscrow.id, 'RELEASE');

    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      42n,
      'RELEASE',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    expect(disputeRepository.update).toHaveBeenCalledWith({
      where: { id: 'dispute-1' },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
    });
    expect(repository.markCompleted).toHaveBeenCalledWith(disputedEscrow.id);
    expect(result.state).toBe('COMPLETED');
  });

  it('REFUND resolution calls contract and marks escrow REFUNDED', async () => {
    const refunded = { ...disputedEscrow, state: 'REFUNDED' as const };
    repository.findById.mockResolvedValue(disputedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markRefunded.mockResolvedValue(refunded);

    const result = await service.resolve(disputedEscrow.id, 'REFUND');

    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      42n,
      'REFUND',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    expect(repository.markRefunded).toHaveBeenCalledWith(disputedEscrow.id);
    expect(result.state).toBe('REFUNDED');
  });

  it('closes an UNDER_REVIEW dispute with a resolvedAt timestamp (#925)', async () => {
    const completed = { ...disputedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(disputedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);
    disputeRepository.findFirst.mockResolvedValue({
      id: 'dispute-2',
      escrowId: disputedEscrow.id,
      status: 'UNDER_REVIEW',
    } as never);

    await service.resolve(disputedEscrow.id, 'RELEASE');

    expect(disputeRepository.findFirst).toHaveBeenCalledWith({
      where: {
        escrowId: disputedEscrow.id,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
    });
    expect(disputeRepository.update).toHaveBeenCalledWith({
      where: { id: 'dispute-2' },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
    });
  });

  it.each(['FUNDED', 'CANCELLED', 'RELEASED', 'CREATED', 'SHIPPED'] as const)(
    'throws ConflictException and makes no contract call for a %s escrow (#924)',
    async (state) => {
      repository.findById.mockResolvedValue({ ...disputedEscrow, state });

      await expect(
        service.resolve(disputedEscrow.id, 'RELEASE'),
      ).rejects.toThrow(ConflictException);
      expect(contractService.resolveDispute).not.toHaveBeenCalled();
      expect(repository.markCompleted).not.toHaveBeenCalled();
      expect(repository.markRefunded).not.toHaveBeenCalled();
    },
  );

  it('still resolves a DISPUTED escrow after the non-disputed refusals (#924)', async () => {
    const completed = { ...disputedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(disputedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);

    const result = await service.resolve(disputedEscrow.id, 'RELEASE');

    expect(result.state).toBe('COMPLETED');
  });

  it('throws ConflictException when escrow is already COMPLETED', async () => {
    repository.findById.mockResolvedValue({
      ...disputedEscrow,
      state: 'COMPLETED',
    });

    await expect(
      service.resolve(disputedEscrow.id, 'RELEASE'),
    ).rejects.toThrow(ConflictException);
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  it('throws ConflictException when escrow is already REFUNDED', async () => {
    repository.findById.mockResolvedValue({
      ...disputedEscrow,
      state: 'REFUNDED',
    });

    await expect(
      service.resolve(disputedEscrow.id, 'REFUND'),
    ).rejects.toThrow(ConflictException);
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  it('does not update escrow state when contract resolution fails', async () => {
    repository.findById.mockResolvedValue(disputedEscrow);
    contractService.resolveDispute.mockRejectedValue(
      new Error('Network failure'),
    );

    await expect(
      service.resolve(disputedEscrow.id, 'RELEASE'),
    ).rejects.toThrow('Network failure');
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(repository.markRefunded).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when escrow does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.resolve('missing', 'RELEASE')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ConflictException when the escrow has no contractEscrowId', async () => {
    repository.findById.mockResolvedValue({
      ...disputedEscrow,
      contractEscrowId: null,
    });

    await expect(
      service.resolve(disputedEscrow.id, 'RELEASE'),
    ).rejects.toThrow(ConflictException);
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  it('completes the escrow without touching the dispute record when none is open', async () => {
    const completed = { ...disputedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(disputedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);
    // disputeRepository.findFirst defaults to resolving null in beforeEach.

    const result = await service.resolve(disputedEscrow.id, 'RELEASE');

    expect(disputeRepository.update).not.toHaveBeenCalled();
    expect(result.state).toBe('COMPLETED');
  });

  describe('notifications on resolution (#927)', () => {
    it('RELEASE calls notifyCompleted with the completed escrow, after the state is written', async () => {
      const completed = { ...disputedEscrow, state: 'COMPLETED' as const };
      repository.findById.mockResolvedValue(disputedEscrow);
      contractService.resolveDispute.mockResolvedValue('tx-hash');
      repository.markCompleted.mockResolvedValue(completed);

      await service.resolve(disputedEscrow.id, 'RELEASE');

      expect(notificationsService.notifyCompleted).toHaveBeenCalledWith(
        completed,
      );
      expect(notificationsService.notifyRefunded).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyCompleted.mock.invocationCallOrder[0],
      ).toBeGreaterThan(repository.markCompleted.mock.invocationCallOrder[0]);
    });

    it('REFUND calls notifyRefunded with the refunded escrow, after the state is written', async () => {
      const refunded = { ...disputedEscrow, state: 'REFUNDED' as const };
      repository.findById.mockResolvedValue(disputedEscrow);
      contractService.resolveDispute.mockResolvedValue('tx-hash');
      repository.markRefunded.mockResolvedValue(refunded);

      await service.resolve(disputedEscrow.id, 'REFUND');

      expect(notificationsService.notifyRefunded).toHaveBeenCalledWith(
        refunded,
      );
      expect(notificationsService.notifyCompleted).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyRefunded.mock.invocationCallOrder[0],
      ).toBeGreaterThan(repository.markRefunded.mock.invocationCallOrder[0]);
    });

    it('still returns the resolved escrow when notifyCompleted rejects', async () => {
      const completed = { ...disputedEscrow, state: 'COMPLETED' as const };
      repository.findById.mockResolvedValue(disputedEscrow);
      contractService.resolveDispute.mockResolvedValue('tx-hash');
      repository.markCompleted.mockResolvedValue(completed);
      notificationsService.notifyCompleted.mockRejectedValue(
        new Error('SendGrid down'),
      );

      const result = await service.resolve(disputedEscrow.id, 'RELEASE');

      expect(result.state).toBe('COMPLETED');
    });

    it('still returns the resolved escrow when notifyRefunded rejects', async () => {
      const refunded = { ...disputedEscrow, state: 'REFUNDED' as const };
      repository.findById.mockResolvedValue(disputedEscrow);
      contractService.resolveDispute.mockResolvedValue('tx-hash');
      repository.markRefunded.mockResolvedValue(refunded);
      notificationsService.notifyRefunded.mockRejectedValue(
        new Error('SendGrid down'),
      );

      const result = await service.resolve(disputedEscrow.id, 'REFUND');

      expect(result.state).toBe('REFUNDED');
    });
  });

  it('requireAdminAddress throws ConflictException when ADMIN_ADDRESS is unset', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputeService,
        { provide: EscrowRepository, useValue: repository },
        { provide: ContractService, useValue: contractService },
        { provide: DisputeRepository, useValue: disputeRepository },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();
    const unconfigured = moduleRef.get(DisputeService);
    repository.findById.mockResolvedValue(disputedEscrow);

    await expect(
      unconfigured.resolve(disputedEscrow.id, 'RELEASE'),
    ).rejects.toThrow(ConflictException);
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  describe('getDisputes', () => {
    it('applies default page/limit and no status filter when the query is empty', async () => {
      const result = await service.getDisputes({});

      expect(disputeRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined, skip: 0, take: 20 }),
      );
      expect(disputeRepository.count).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('filters by status and computes skip from page/limit', async () => {
      await service.getDisputes({ status: 'OPEN', page: 3, limit: 10 });

      expect(disputeRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'OPEN' },
          skip: 20,
          take: 10,
        }),
      );
    });

    it('clamps page below 1 up to 1', async () => {
      const result = await service.getDisputes({ page: 0 });

      expect(result.page).toBe(1);
      expect(disputeRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps limit above 100 down to 100, and below 1 up to 1', async () => {
      const tooHigh = await service.getDisputes({ limit: 500 });
      expect(tooHigh.limit).toBe(100);

      const tooLow = await service.getDisputes({ limit: 0 });
      expect(tooLow.limit).toBe(1);
    });

    it('returns the repository records and the total count', async () => {
      const dispute = {
        id: 'dispute-1',
        escrowId: disputedEscrow.id,
        status: 'OPEN',
        reason: 'Item not delivered',
        description: '',
        evidenceUrls: [],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        resolvedAt: null,
      };
      disputeRepository.findMany.mockResolvedValue([dispute] as never);
      disputeRepository.count.mockResolvedValue(1);

      const result = await service.getDisputes({});

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'dispute-1',
        status: 'OPEN',
      });
    });
  });
});

// ── endpoint-level tests (admin guard) ───────────────────────────────────

describe('PATCH /admin/dispute/:id/resolve (admin guard)', () => {
  let app: INestApplication;
  let disputeService: jest.Mocked<DisputeService>;
  const ESCROW_ID = '0f0a3c8e-1f2b-4c3d-9e8f-1a2b3c4d5e6f';

  // Mock ConfigService so AdminGuard can resolve ADMIN_ADDRESS
  const mockConfigService = {
    get: jest.fn().mockReturnValue('admin-address'),
  };
  // The mocked ConfigService answers every key, SEP10_JWT_SECRET included,
  // with 'admin-address', so tokens are signed with that value.
  const VENDOR_AUTH = bearer('vendor-address', { secret: 'admin-address' });
  const ADMIN_AUTH = bearer('admin-address', {
    role: 'admin',
    secret: 'admin-address',
  });

  beforeEach(async () => {
    disputeService = {
      resolve: jest.fn().mockResolvedValue({
        ...disputedEscrow,
        state: 'COMPLETED',
      }),
    } as unknown as jest.Mocked<DisputeService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DisputeController],
      providers: [
        { provide: DisputeService, useValue: disputeService },
        { provide: ConfigService, useValue: mockConfigService },
        JwtGuard,
        AdminGuard,
        {
          provide: AuditLogService,
          useValue: {
            append: jest.fn().mockResolvedValue({ id: '1' }),
            findAll: jest
              .fn()
              .mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for a vendor-role JWT', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/dispute/${ESCROW_ID}/resolve`)
      .set('Authorization', VENDOR_AUTH)
      .send({ resolution: 'RELEASE' })
      .expect(403);
  });

  it('returns 200 for an admin-role JWT', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/admin/dispute/${ESCROW_ID}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .send({ resolution: 'RELEASE' })
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ state: 'COMPLETED' }));
  });

  it('returns 400 for a non-UUID escrow id (#925)', async () => {
    await request(app.getHttpServer())
      .patch('/admin/dispute/escrow-1/resolve')
      .set('Authorization', ADMIN_AUTH)
      .send({ resolution: 'RELEASE' })
      .expect(400);

    expect(disputeService.resolve).not.toHaveBeenCalled();
  });

  it('propagates ConflictException (409) from service', async () => {
    disputeService.resolve.mockRejectedValue(
      new ConflictException('Dispute has already been resolved'),
    );

    await request(app.getHttpServer())
      .patch(`/admin/dispute/${ESCROW_ID}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .send({ resolution: 'RELEASE' })
      .expect(409);
  });

  it('throws ForbiddenException instead of propagating to non-admin', async () => {
    // Even if the service would throw, the guard fires first
    disputeService.resolve.mockRejectedValue(new ForbiddenException());

    await request(app.getHttpServer())
      .patch(`/admin/dispute/${ESCROW_ID}/resolve`)
      .set('Authorization', VENDOR_AUTH)
      .send({ resolution: 'RELEASE' })
      .expect(403);

    expect(disputeService.resolve).not.toHaveBeenCalled();
  });
});
