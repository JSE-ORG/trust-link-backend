import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../../config/config.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

describe('DisputeController', () => {
  let controller: DisputeController;
  let disputeService: jest.Mocked<Pick<DisputeService, 'getDisputes' | 'resolve'>>;
  let auditLogService: jest.Mocked<Pick<AuditLogService, 'findAll' | 'append'>>;

  beforeEach(async () => {
    disputeService = {
      getDisputes: jest.fn(),
      resolve: jest.fn(),
    } as jest.Mocked<Pick<DisputeService, 'getDisputes' | 'resolve'>>;

    auditLogService = {
      findAll: jest.fn(),
      append: jest.fn(),
    } as jest.Mocked<Pick<AuditLogService, 'findAll' | 'append'>>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisputeController],
      providers: [
        { provide: ConfigService, useValue: { get: jest.fn(() => 'GADMIN123') } },
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
      disputeService.getDisputes.mockResolvedValue(expected as never);

      const result = await controller.getDisputes();

      expect(disputeService.getDisputes).toHaveBeenCalledWith({
        status: undefined,
        page: undefined,
        limit: undefined,
      });
      expect(result).toBe(expected);
    });

    it('delegates with the supplied status, page, and limit', async () => {
      const expected = {
        data: [],
        total: 1,
        page: 2,
        limit: 25,
      };
      disputeService.getDisputes.mockResolvedValue(expected as never);

      const result = await controller.getDisputes('OPEN', '2', '25');

      expect(disputeService.getDisputes).toHaveBeenCalledWith({
        status: 'OPEN',
        page: 2,
        limit: 25,
      });
      expect(result).toBe(expected);
    });

    it('delegates with page only when limit is omitted', async () => {
      const expected = {
        data: [],
        total: 1,
        page: 3,
        limit: 20,
      };
      disputeService.getDisputes.mockResolvedValue(expected as never);

      const result = await controller.getDisputes('OPEN', '3', undefined);

      expect(disputeService.getDisputes).toHaveBeenCalledWith({
        status: 'OPEN',
        page: 3,
        limit: undefined,
      });
      expect(result).toBe(expected);
    });

    it('delegates with limit only when page is omitted', async () => {
      const expected = {
        data: [],
        total: 1,
        page: 1,
        limit: 15,
      };
      disputeService.getDisputes.mockResolvedValue(expected as never);

      const result = await controller.getDisputes('OPEN', undefined, '15');

      expect(disputeService.getDisputes).toHaveBeenCalledWith({
        status: 'OPEN',
        page: undefined,
        limit: 15,
      });
      expect(result).toBe(expected);
    });

    it('keeps the current behavior for a non-numeric page query value', async () => {
      const expected = {
        data: [],
        total: 0,
        page: 1,
        limit: 10,
      };
      disputeService.getDisputes.mockResolvedValue(expected as never);

      await controller.getDisputes('OPEN', 'abc', '10');

      expect(disputeService.getDisputes).toHaveBeenCalledWith({
        status: 'OPEN',
        page: Number.NaN,
        limit: 10,
      });
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
    it('delegates to the audit log service', () => {
      const log = [{ id: '1', action: 'DISPUTE_RESOLVED' }];
      auditLogService.findAll.mockReturnValue(log as never);

      const result = controller.getAuditLog();

      expect(auditLogService.findAll).toHaveBeenCalledTimes(1);
      expect(result).toBe(log);
    });
  });
});
