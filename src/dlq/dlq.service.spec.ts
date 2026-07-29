import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DlqService } from './dlq.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DlqService', () => {
  let service: DlqService;
  let prismaMock: {
    failedTransaction: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };

  const mockRecord = {
    id: 'test-id-1',
    operation: 'submitTransaction',
    escrowId: 'escrow-123',
    errorMessage: 'Transaction failed',
    ledgerFeedback: { resultXdr: 'AAA...' },
    attempts: 1,
    status: 'PENDING_REVIEW',
    lastReplayTxHash: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    reviewedAt: null,
    replayedAt: null,
  };

  beforeEach(async () => {
    prismaMock = {
      failedTransaction: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DlqService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get(DlqService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enqueue', () => {
    it('should create a new failed transaction', async () => {
      prismaMock.failedTransaction.create.mockResolvedValue(mockRecord);

      const result = await service.enqueue({
        operation: 'submitTransaction',
        escrowId: 'escrow-123',
        errorMessage: 'Transaction failed',
        ledgerFeedback: { resultXdr: 'AAA...' },
      });

      expect(result.id).toBe('test-id-1');
      expect(result.operation).toBe('submitTransaction');
      expect(result.status).toBe('PENDING_REVIEW');
      expect(prismaMock.failedTransaction.create).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should return paginated records when no query filters', async () => {
      prismaMock.failedTransaction.findMany.mockResolvedValue([mockRecord]);
      prismaMock.failedTransaction.count.mockResolvedValue(1);

      const result = await service.list();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('test-id-1');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prismaMock.failedTransaction.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });

    it('should filter by status', async () => {
      prismaMock.failedTransaction.findMany.mockResolvedValue([mockRecord]);
      prismaMock.failedTransaction.count.mockResolvedValue(1);

      await service.list({ status: 'PENDING_REVIEW' });
      expect(prismaMock.failedTransaction.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });

    it('should filter by operation and support custom pagination', async () => {
      prismaMock.failedTransaction.findMany.mockResolvedValue([]);
      prismaMock.failedTransaction.count.mockResolvedValue(0);

      const result = await service.list({
        operation: 'submitTransaction',
        page: 2,
        limit: 10,
      });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(prismaMock.failedTransaction.findMany).toHaveBeenCalledWith({
        where: { operation: 'submitTransaction' },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
    });
  });

  describe('get', () => {
    it('should return a record by id', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);

      const result = await service.get('test-id-1');
      expect(result.id).toBe('test-id-1');
    });

    it('should throw NotFoundException when record not found', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(null);

      await expect(service.get('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('replay', () => {
    it('should mark record as REPLAYED on success', async () => {
      const updatedRecord = {
        ...mockRecord,
        status: 'REPLAYED',
        lastReplayTxHash: 'tx-hash-123',
      };
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      prismaMock.failedTransaction.update.mockResolvedValue(updatedRecord);

      const replayFn = jest.fn().mockResolvedValue('tx-hash-123');
      const result = await service.replay('test-id-1', replayFn);

      expect(result.status).toBe('REPLAYED');
      expect(result.lastReplayTxHash).toBe('tx-hash-123');
    });

    it('should increment attempts on replay failure', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      prismaMock.failedTransaction.update.mockResolvedValue({});

      const replayFn = jest.fn().mockRejectedValue(new Error('Replay failed'));

      await expect(service.replay('test-id-1', replayFn)).rejects.toThrow(
        'Replay failed',
      );
      expect(prismaMock.failedTransaction.update).toHaveBeenCalledWith({
        where: { id: 'test-id-1' },
        data: {
          attempts: { increment: 1 },
          errorMessage: 'Replay failed',
        },
      });
    });

    it('should throw if record is not PENDING_REVIEW', async () => {
      const replayedRecord = { ...mockRecord, status: 'REPLAYED' };
      prismaMock.failedTransaction.findUnique.mockResolvedValue(replayedRecord);

      const replayFn = jest.fn();
      await expect(service.replay('test-id-1', replayFn)).rejects.toThrow(
        'not pending review',
      );
    });
  });

  describe('abandon', () => {
    it('should mark record as ABANDONED', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      prismaMock.failedTransaction.update.mockResolvedValue({
        ...mockRecord,
        status: 'ABANDONED',
      });

      const result = await service.abandon('test-id-1');
      expect(result.status).toBe('ABANDONED');
    });
  });

  describe('markReviewed', () => {
    it('should set reviewedAt timestamp', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      prismaMock.failedTransaction.update.mockResolvedValue({
        ...mockRecord,
        reviewedAt: new Date(),
      });

      const result = await service.markReviewed('test-id-1');
      expect(result.reviewedAt).toBeDefined();
    });
  });
});
