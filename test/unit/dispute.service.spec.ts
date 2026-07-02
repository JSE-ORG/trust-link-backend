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

    prisma = {} as unknown as jest.Mocked<PrismaService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputeService,
        { provide: EscrowRepository, useValue: repository },
        { provide: ContractService, useValue: contractService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(DisputeService);
  });

  it('RELEASE resolution calls contract and marks escrow COMPLETED', async () => {
    const completed = { ...shippedEscrow, state: 'COMPLETED' as const };
    repository.findById.mockResolvedValue(shippedEscrow);
    contractService.resolveDispute.mockResolvedValue('tx-hash');
    repository.markCompleted.mockResolvedValue(completed);

    const result = await service.resolve('escrow-1', 'RELEASE');

    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      'escrow-1',
      'RELEASE',
    );
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
      'escrow-1',
      'REFUND',
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
