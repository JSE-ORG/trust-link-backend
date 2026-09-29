import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { AuditLogRepository } from './audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditLogService (Issues #816 & #817)', () => {
  let service: AuditLogService;
  // Issue #846: the service calls the repository, not PrismaService.
  let prisma: {
    auditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let repo: {
    append: jest.Mock;
    findPage: jest.Mock;
    count: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    // The repository mock forwards to the Prisma-shaped mock so the
    // expectations below stay exactly as they were. findPage copies each row,
    // as the real repository does when it maps records to entries.
    repo = {
      append: jest.fn().mockImplementation(async ({ details, ...rest }) =>
        prisma.auditLog.create({
          data: { details: details ?? {}, ...rest },
        }),
      ),
      findPage: jest
        .fn()
        .mockImplementation(async (options: { skip: number; take: number }) => {
          const rows: Record<string, unknown>[] =
            await prisma.auditLog.findMany({
              ...options,
              orderBy: { occurredAt: 'desc' },
            });
          return rows.map((row) => ({ ...row }));
        }),
      count: jest.fn().mockImplementation(() => prisma.auditLog.count()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: AuditLogRepository, useValue: repo },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('append-only guarantees', () => {
    it('does not expose update or delete methods on the service', () => {
      const untypedService = service as unknown as Record<string, unknown>;
      expect(untypedService.update).toBeUndefined();
      expect(untypedService.delete).toBeUndefined();
      expect(untypedService.remove).toBeUndefined();
      expect(untypedService.clear).toBeUndefined();
      expect(untypedService.truncate).toBeUndefined();
    });

    it('returns a detached array and entries from findAll', async () => {
      const storedEntry = {
        id: 'audit-1',
        action: 'DISPUTE_RESOLVED',
        adminAddress: 'GADMIN123',
        entityType: 'escrow',
        entityId: 'escrow-1',
        details: { resolution: 'RELEASE' },
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      prisma.auditLog.findMany.mockResolvedValue([storedEntry] as never);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll();
      result.data[0].action = 'MUTATED';
      result.data.splice(0, 1);

      expect(storedEntry.action).toBe('DISPUTE_RESOLVED');
      expect(storedEntry.id).toBe('audit-1');
      expect(result.data).toHaveLength(0);
    });
  });

  describe('append', () => {
    it('persists a new audit log record to the database', async () => {
      const now = new Date();
      const mockCreated = {
        id: 'cuid-123',
        action: 'DISPUTE_RESOLVED',
        adminAddress: 'GADMIN123',
        entityType: 'escrow',
        entityId: 'escrow-456',
        details: { resolution: 'RELEASE' },
        occurredAt: now,
      };

      prisma.auditLog.create.mockResolvedValue(mockCreated);

      const result = await service.append({
        action: 'DISPUTE_RESOLVED',
        adminAddress: 'GADMIN123',
        entityType: 'escrow',
        entityId: 'escrow-456',
        details: { resolution: 'RELEASE' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: 'DISPUTE_RESOLVED',
          adminAddress: 'GADMIN123',
          entityType: 'escrow',
          entityId: 'escrow-456',
          details: { resolution: 'RELEASE' },
        },
      });

      expect(result).toEqual({
        id: 'cuid-123',
        action: 'DISPUTE_RESOLVED',
        adminAddress: 'GADMIN123',
        entityType: 'escrow',
        entityId: 'escrow-456',
        details: { resolution: 'RELEASE' },
        occurredAt: now,
      });
    });

    it('handles details when omitted or empty', async () => {
      const now = new Date();
      prisma.auditLog.create.mockResolvedValue({
        id: 'cuid-124',
        action: 'ADMIN_LOGIN',
        adminAddress: 'GADMIN123',
        entityType: 'admin',
        entityId: 'GADMIN123',
        details: {},
        occurredAt: now,
      });

      const result = await service.append({
        action: 'ADMIN_LOGIN',
        adminAddress: 'GADMIN123',
        entityType: 'admin',
        entityId: 'GADMIN123',
        details: {},
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: 'ADMIN_LOGIN',
          adminAddress: 'GADMIN123',
          entityType: 'admin',
          entityId: 'GADMIN123',
          details: {},
        },
      });
      expect(result.id).toBe('cuid-124');
    });
  });

  describe('findAll and pagination (Issue #817)', () => {
    it('queries with default pagination (page 1, limit 20) and newest-first order', async () => {
      const rows = [
        {
          id: '1',
          action: 'DISPUTE_RESOLVED',
          adminAddress: 'GADMIN',
          entityType: 'escrow',
          entityId: 'esc-1',
          details: {},
          occurredAt: new Date('2026-05-27T10:00:00Z'),
        },
      ];
      prisma.auditLog.findMany.mockResolvedValue(rows);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        orderBy: { occurredAt: 'desc' },
      });
      expect(prisma.auditLog.count).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        data: rows,
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('applies custom page and limit properly', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(45);

      const result = await service.findAll({ page: 3, limit: 10 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        skip: 20,
        take: 10,
        orderBy: { occurredAt: 'desc' },
      });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(45);
    });

    it('clamps page < 1 to page 1', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({ page: -5, limit: 10 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { occurredAt: 'desc' },
      });
      expect(result.page).toBe(1);
    });

    it('clamps limit > 100 to 100 and limit < 1 to 1', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const resultMax = await service.findAll({ page: 1, limit: 500 });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 100,
        orderBy: { occurredAt: 'desc' },
      });
      expect(resultMax.limit).toBe(100);

      const resultMin = await service.findAll({ page: 1, limit: 0 });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 1,
        orderBy: { occurredAt: 'desc' },
      });
      expect(resultMin.limit).toBe(1);
    });

    it('handles non-numeric / NaN pagination values with defaults', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({
        page: Number.NaN,
        limit: Number.NaN,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        orderBy: { occurredAt: 'desc' },
      });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('persistence across service instances (Issue #816)', () => {
    it('records survive across separate service instances sharing the database', async () => {
      const inMemoryDb: Array<{
        id: string;
        action: string;
        adminAddress: string;
        entityType: string;
        entityId: string;
        details: any;
        occurredAt: Date;
      }> = [];

      const sharedPrisma = {
        auditLog: {
          create: jest.fn().mockImplementation(async ({ data }) => {
            const entry = {
              id: `cuid-${inMemoryDb.length + 1}`,
              ...data,
              occurredAt: new Date(),
            };
            inMemoryDb.push(entry);
            return entry;
          }),
          findMany: jest.fn().mockImplementation(async () => [...inMemoryDb]),
          count: jest.fn().mockImplementation(async () => inMemoryDb.length),
        },
      } as unknown as PrismaService;

      // Instance 1 creates a record
      const instance1 = new AuditLogService(
        new AuditLogRepository(sharedPrisma),
      );
      await instance1.append({
        action: 'VENDOR_SUSPENDED',
        adminAddress: 'GADMIN123',
        entityType: 'vendor',
        entityId: 'GVENDOR456',
        details: { reason: 'Policy violation' },
      });

      // Instance 2 (representing a restart or a different replica) reads the record
      const instance2 = new AuditLogService(
        new AuditLogRepository(sharedPrisma),
      );
      const res = await instance2.findAll();

      expect(res.total).toBe(1);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].action).toBe('VENDOR_SUSPENDED');
      expect(res.data[0].entityId).toBe('GVENDOR456');
    });
  });
});
