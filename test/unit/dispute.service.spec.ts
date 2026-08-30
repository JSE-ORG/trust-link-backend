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
import { EscrowRecord, PrismaService } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';
import { DisputeController } from '../../src/admin/dispute/dispute.controller';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { ConfigService } from '../../src/config/config.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';

// ── shared fixture ────────────────────────────────────────────────────────

const shippedEscrow: EscrowRecord = {
  id: 'escrow-1',
  contractEscrowId: 42n,
  itemName: 'Vintage camera',
  itemRef: 'camera-001',
  amount: 200,
  currency: 'USDC',
  buyerAddress: 'buyer-address',
  vendorAddress: 'vendor-address',
  state: 'SHIPPED',
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

describe('DisputeService (issue #25)', () => {
  let service: DisputeService;
  let repository: jest.Mocked<EscrowRepository>;
  let contractService: jest.Mocked<ContractService>;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      markCompleted: jest.fn(),
      markRefunded: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    contractService = {
      resolveDispute: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    prisma = {
      dispute: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputeService,
        { provide: EscrowRepository, useValue: repository },
        { provide: ContractService, useValue: contractService },
        { provide: PrismaService, useValue: prisma },
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
    const completed = { ...shippedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(shippedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);
    (prisma.dispute.findFirst as jest.Mock).mockResolvedValue({
      id: 'dispute-1',
      escrowId: 'escrow-1',
      status: 'OPEN',
    });

    const result = await service.resolve('escrow-1', 'RELEASE');

    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      42n,
      'RELEASE',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    expect(prisma.dispute.update).toHaveBeenCalledWith({
      where: { id: 'dispute-1' },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
    });
    expect(repository.markCompleted).toHaveBeenCalledWith('escrow-1');
    expect(result.state).toBe('COMPLETED');
  });

  it('REFUND resolution calls contract and marks escrow REFUNDED', async () => {
    const refunded = { ...shippedEscrow, state: 'REFUNDED' as const };
    repository.findById.mockResolvedValue(shippedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markRefunded.mockResolvedValue(refunded);

    const result = await service.resolve('escrow-1', 'REFUND');

    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      42n,
      'REFUND',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    expect(repository.markRefunded).toHaveBeenCalledWith('escrow-1');
    expect(result.state).toBe('REFUNDED');
  });

  it('throws ConflictException when escrow is already COMPLETED', async () => {
    repository.findById.mockResolvedValue({
      ...shippedEscrow,
      state: 'COMPLETED',
    });

    await expect(service.resolve('escrow-1', 'RELEASE')).rejects.toThrow(
      ConflictException,
    );
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  it('throws ConflictException when escrow is already REFUNDED', async () => {
    repository.findById.mockResolvedValue({
      ...shippedEscrow,
      state: 'REFUNDED',
    });

    await expect(service.resolve('escrow-1', 'REFUND')).rejects.toThrow(
      ConflictException,
    );
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  it('does not update escrow state when contract resolution fails', async () => {
    repository.findById.mockResolvedValue(shippedEscrow);
    contractService.resolveDispute.mockRejectedValue(
      new Error('Network failure'),
    );

    await expect(service.resolve('escrow-1', 'RELEASE')).rejects.toThrow(
      'Network failure',
    );
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
      ...shippedEscrow,
      contractEscrowId: null,
    });

    await expect(service.resolve('escrow-1', 'RELEASE')).rejects.toThrow(
      ConflictException,
    );
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  it('completes the escrow without touching the dispute record when none is OPEN', async () => {
    const completed = { ...shippedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(shippedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);
    // prisma.dispute.findFirst defaults to resolving null in beforeEach.

    const result = await service.resolve('escrow-1', 'RELEASE');

    expect(prisma.dispute.update).not.toHaveBeenCalled();
    expect(result.state).toBe('COMPLETED');
  });

  it('requireAdminAddress throws ConflictException when ADMIN_ADDRESS is unset', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputeService,
        { provide: EscrowRepository, useValue: repository },
        { provide: ContractService, useValue: contractService },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      ],
    }).compile();
    const unconfigured = moduleRef.get(DisputeService);
    repository.findById.mockResolvedValue(shippedEscrow);

    await expect(unconfigured.resolve('escrow-1', 'RELEASE')).rejects.toThrow(
      ConflictException,
    );
    expect(contractService.resolveDispute).not.toHaveBeenCalled();
  });

  describe('getDisputes', () => {
    it('applies default page/limit and no status filter when the query is empty', async () => {
      prisma.dispute.findMany = jest.fn().mockResolvedValue([]);
      prisma.dispute.count = jest.fn().mockResolvedValue(0);

      const result = await service.getDisputes({});

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined, skip: 0, take: 20 }),
      );
      expect(prisma.dispute.count).toHaveBeenCalledWith({ where: undefined });
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('filters by status and computes skip from page/limit', async () => {
      prisma.dispute.findMany = jest.fn().mockResolvedValue([]);
      prisma.dispute.count = jest.fn().mockResolvedValue(0);

      await service.getDisputes({ status: 'OPEN', page: 3, limit: 10 });

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'OPEN' },
          skip: 20,
          take: 10,
        }),
      );
    });

    it('clamps page below 1 up to 1', async () => {
      prisma.dispute.findMany = jest.fn().mockResolvedValue([]);
      prisma.dispute.count = jest.fn().mockResolvedValue(0);

      const result = await service.getDisputes({ page: 0 });

      expect(result.page).toBe(1);
      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps limit above 100 down to 100, and below 1 up to 1', async () => {
      prisma.dispute.findMany = jest.fn().mockResolvedValue([]);
      prisma.dispute.count = jest.fn().mockResolvedValue(0);

      const tooHigh = await service.getDisputes({ limit: 500 });
      expect(tooHigh.limit).toBe(100);

      const tooLow = await service.getDisputes({ limit: 0 });
      expect(tooLow.limit).toBe(1);
    });

    it('maps records through toDisputeRecord and returns the total count', async () => {
      const rawDispute = {
        id: 'dispute-1',
        escrowId: 'escrow-1',
        status: 'OPEN',
        reason: 'Item not delivered',
        description: '',
        evidenceUrls: [],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        resolvedAt: null,
      };
      prisma.dispute.findMany = jest.fn().mockResolvedValue([rawDispute]);
      prisma.dispute.count = jest.fn().mockResolvedValue(1);

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

  // Mock ConfigService so AdminGuard can resolve ADMIN_ADDRESS
  const mockConfigService = {
    get: jest.fn().mockReturnValue('admin-address'),
  };

  beforeEach(async () => {
    disputeService = {
      resolve: jest.fn().mockResolvedValue({
        ...shippedEscrow,
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
        AuditLogService,
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
      .patch('/admin/dispute/escrow-1/resolve')
      .set(
        'Authorization',
        'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ2ZW5kb3ItYWRkcmVzcyIsInJvbGUiOiJ2ZW5kb3IifQ.tZDbS0v2ze8t-x6hZsE1Q1hP0odlamTWSFZlwjPNwXk',
      )
      .send({ resolution: 'RELEASE' })
      .expect(403);
  });

  it('returns 200 for an admin-role JWT', async () => {
    const res = await request(app.getHttpServer())
      .patch('/admin/dispute/escrow-1/resolve')
      .set(
        'Authorization',
        'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbi1hZGRyZXNzIiwicm9sZSI6ImFkbWluIn0.Q4EeLZuB3V0utXclLNM02bCZ_WyNHFaZukHcMTjHa6o',
      )
      .send({ resolution: 'RELEASE' })
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ state: 'COMPLETED' }));
  });

  it('propagates ConflictException (409) from service', async () => {
    disputeService.resolve.mockRejectedValue(
      new ConflictException('Dispute has already been resolved'),
    );

    await request(app.getHttpServer())
      .patch('/admin/dispute/escrow-1/resolve')
      .set(
        'Authorization',
        'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbi1hZGRyZXNzIiwicm9sZSI6ImFkbWluIn0.Q4EeLZuB3V0utXclLNM02bCZ_WyNHFaZukHcMTjHa6o',
      )
      .send({ resolution: 'RELEASE' })
      .expect(409);
  });

  it('throws ForbiddenException instead of propagating to non-admin', async () => {
    // Even if the service would throw, the guard fires first
    disputeService.resolve.mockRejectedValue(new ForbiddenException());

    await request(app.getHttpServer())
      .patch('/admin/dispute/escrow-1/resolve')
      .set(
        'Authorization',
        'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ2ZW5kb3ItYWRkcmVzcyIsInJvbGUiOiJ2ZW5kb3IifQ.tZDbS0v2ze8t-x6hZsE1Q1hP0odlamTWSFZlwjPNwXk',
      )
      .send({ resolution: 'RELEASE' })
      .expect(403);

    expect(disputeService.resolve).not.toHaveBeenCalled();
  });
});
