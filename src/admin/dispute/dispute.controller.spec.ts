import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../../config/config.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';
import { AdminDisputesQueryDto } from './dto/admin-disputes-query.dto';
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';

describe('DisputeController', () => {
  let controller: DisputeController;
  let disputeService: jest.Mocked<
    Pick<DisputeService, 'getDisputes' | 'resolve'>
  >;
  let auditLogService: jest.Mocked<Pick<AuditLogService, 'findAll' | 'append'>>;

  beforeEach(async () => {
    disputeService = {
      getDisputes: jest.fn(),
      resolve: jest.fn(),
    };

    auditLogService = {
      findAll: jest.fn(),
      append: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisputeController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'GADMIN123') },
        },
        { provide: DisputeService, useValue: disputeService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    controller = module.get(DisputeController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDisputes', () => {
    it('delegates with undefined pagination when no query params are provided', async () => {
      const expected = {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      };
      disputeService.getDisputes.mockResolvedValue(expected);

      const query = new AdminDisputesQueryDto();
      const result = await controller.getDisputes(query);

      expect(disputeService.getDisputes).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });

    it('delegates with the supplied status, page, and limit', async () => {
      const expected = {
        data: [],
        total: 1,
        page: 2,
        limit: 25,
      };
      disputeService.getDisputes.mockResolvedValue(expected);

      const query = Object.assign(new AdminDisputesQueryDto(), {
        status: 'OPEN',
        page: 2,
        limit: 25,
      });
      const result = await controller.getDisputes(query);

      expect(disputeService.getDisputes).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });

    it('passes status, page, and limit through unchanged', async () => {
      const expected = { data: [], total: 1, page: 2, limit: 25 };
      const query = Object.assign(new AdminDisputesQueryDto(), {
        status: 'OPEN',
        page: 2,
        limit: 25,
      });
      disputeService.getDisputes.mockResolvedValue(expected);

      const result = await controller.getDisputes(query);

      expect(disputeService.getDisputes).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });
  });

  describe('resolve', () => {
    it('resolves the dispute and records the audit log', async () => {
      const expected = { id: 'escrow-123', state: 'COMPLETED' };
      disputeService.resolve.mockResolvedValue(expected as never);

      const admin = { address: 'GADMIN123', role: 'admin' };
      const result = await controller.resolve(
        'escrow-123',
        { resolution: 'RELEASE' },
        admin,
      );

      expect(disputeService.resolve).toHaveBeenCalledWith(
        'escrow-123',
        'RELEASE',
      );
      expect(auditLogService.append).toHaveBeenCalledWith({
        action: 'DISPUTE_RESOLVED',
        adminAddress: 'GADMIN123',
        entityType: 'escrow',
        entityId: 'escrow-123',
        details: { resolution: 'RELEASE' },
      });
      expect(result).toBe(expected);
    });
  });

  describe('getAuditLog', () => {
    it('delegates with undefined pagination when no query params are provided', async () => {
      const expected = {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      };
      auditLogService.findAll.mockResolvedValue(expected);

      const query = new AdminAuditLogQueryDto();
      const result = await controller.getAuditLog(query);

      expect(auditLogService.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });

    it('delegates with the supplied page and limit', async () => {
      const expected = {
        data: [{ id: '1', action: 'DISPUTE_RESOLVED' }],
        total: 1,
        page: 2,
        limit: 25,
      };
      auditLogService.findAll.mockResolvedValue(expected as never);

      const query = Object.assign(new AdminAuditLogQueryDto(), {
        page: 2,
        limit: 25,
      });
      const result = await controller.getAuditLog(query);

      expect(auditLogService.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });

    it('delegates with page only when limit is omitted', async () => {
      const expected = {
        data: [],
        total: 0,
        page: 3,
        limit: 20,
      };
      auditLogService.findAll.mockResolvedValue(expected);

      const query = Object.assign(new AdminAuditLogQueryDto(), { page: 3 });
      const result = await controller.getAuditLog(query);

      expect(auditLogService.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });

    it('delegates with limit only when page is omitted', async () => {
      const expected = {
        data: [],
        total: 0,
        page: 1,
        limit: 15,
      };
      auditLogService.findAll.mockResolvedValue(expected);

      const query = Object.assign(new AdminAuditLogQueryDto(), { limit: 15 });
      const result = await controller.getAuditLog(query);

      expect(auditLogService.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });
  });
});
