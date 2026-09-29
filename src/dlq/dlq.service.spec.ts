import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DlqService } from './dlq.service';
import { FailedTransactionRepository } from './failed-transaction.repository';

describe('DlqService', () => {
  let service: DlqService;
  // Issue #844: the service talks to a repository, not PrismaService, so the
  // suite asserts repository calls and the repository's own suite covers the
  // queries.
  let repoMock: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findById: jest.Mock;
    incrementAttempts: jest.Mock;
    markReplayed: jest.Mock;
    markAbandoned: jest.Mock;
    markReviewed: jest.Mock;
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
    repoMock = {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findById: jest.fn(),
      incrementAttempts: jest.fn(),
      markReplayed: jest.fn(),
      markAbandoned: jest.fn(),
      markReviewed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DlqService,
        { provide: FailedTransactionRepository, useValue: repoMock },
      ],
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
      repoMock.create.mockResolvedValue(mockRecord);

      const result = await service.enqueue({
        operation: 'submitTransaction',
        escrowId: 'escrow-123',
        errorMessage: 'Transaction failed',
        ledgerFeedback: { resultXdr: 'AAA...' },
      });

      expect(result.id).toBe('test-id-1');
      expect(result.operation).toBe('submitTransaction');
      expect(result.status).toBe('PENDING_REVIEW');
      expect(repoMock.create).toHaveBeenCalled();
    });

    it('passes a missing escrowId through for the repository to store as null', async () => {
      repoMock.create.mockResolvedValue({
        ...mockRecord,
        escrowId: null,
      });

      const result = await service.enqueue({
        operation: 'submitTransaction',
        errorMessage: 'Transaction failed',
      });

      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ escrowId: undefined }),
      );
      expect(result.escrowId).toBeNull();
    });
  });

  describe('list', () => {
    it('should return paginated records when no query filters', async () => {
      repoMock.findMany.mockResolvedValue([mockRecord]);
      repoMock.count.mockResolvedValue(1);

      const result = await service.list();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('test-id-1');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(repoMock.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
      });
    });

    it('should filter by status', async () => {
      repoMock.findMany.mockResolvedValue([mockRecord]);
      repoMock.count.mockResolvedValue(1);

      await service.list({ status: 'PENDING_REVIEW' });
      expect(repoMock.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING_REVIEW' },
        skip: 0,
        take: 20,
      });
    });

    it('should filter by operation and support custom pagination', async () => {
      repoMock.findMany.mockResolvedValue([]);
      repoMock.count.mockResolvedValue(0);

      const result = await service.list({
        operation: 'submitTransaction',
        page: 2,
        limit: 10,
      });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(repoMock.findMany).toHaveBeenCalledWith({
        where: { operation: 'submitTransaction' },
        skip: 10,
        take: 10,
      });
    });
  });

  describe('get', () => {
    it('should return a record by id', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);

      const result = await service.get('test-id-1');
      expect(result.id).toBe('test-id-1');
    });

    it('should throw NotFoundException when record not found', async () => {
      repoMock.findById.mockResolvedValue(null);

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
      repoMock.findById.mockResolvedValue(mockRecord);
      repoMock.markReplayed.mockResolvedValue(updatedRecord);

      const replayFn = jest.fn().mockResolvedValue('tx-hash-123');
      const result = await service.replay('test-id-1', replayFn);

      expect(result.status).toBe('REPLAYED');
      expect(result.lastReplayTxHash).toBe('tx-hash-123');
      expect(repoMock.markReplayed).toHaveBeenCalledWith(
        'test-id-1',
        'tx-hash-123',
      );
    });

    it('should increment attempts on replay failure', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);
      repoMock.incrementAttempts.mockResolvedValue({ ...mockRecord });

      const replayFn = jest.fn().mockRejectedValue(new Error('Replay failed'));

      await expect(service.replay('test-id-1', replayFn)).rejects.toThrow(
        'Replay failed',
      );
      expect(repoMock.incrementAttempts).toHaveBeenCalledWith(
        'test-id-1',
        'Replay failed',
      );
    });

    it('should throw if record is not PENDING_REVIEW', async () => {
      const replayedRecord = { ...mockRecord, status: 'REPLAYED' };
      repoMock.findById.mockResolvedValue(replayedRecord);

      const replayFn = jest.fn();
      await expect(service.replay('test-id-1', replayFn)).rejects.toThrow(
        'not pending review',
      );
    });
  });

  describe('abandon', () => {
    it('should mark record as ABANDONED', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);
      repoMock.markAbandoned.mockResolvedValue({
        ...mockRecord,
        status: 'ABANDONED',
      });

      const result = await service.abandon('test-id-1');
      expect(result.status).toBe('ABANDONED');
      expect(repoMock.markAbandoned).toHaveBeenCalledWith('test-id-1');
    });
  });

  describe('markReviewed', () => {
    it('should set reviewedAt timestamp', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);
      repoMock.markReviewed.mockResolvedValue({
        ...mockRecord,
        reviewedAt: new Date(),
      });

      const result = await service.markReviewed('test-id-1');
      expect(result.reviewedAt).toBeDefined();
      expect(repoMock.markReviewed).toHaveBeenCalledWith('test-id-1');
    });
  });

  // ── Ported from test/unit/dlq.service.spec.ts (#753, issue #74) ──────────
  // The test/unit copy (7 tests) overlapped this file on enqueue/list/get,
  // replay success + failure and the REPLAYED guard — those duplicates are
  // dropped. The cases below assert behaviours this file never checked, so
  // they are preserved here.
  describe('ported from test/unit — ledger feedback, escrowId filter, terminal guards', () => {
    it('stores the captured ledger feedback verbatim with attempts=1', async () => {
      const feedback = { resultCodes: ['op_underfunded'], hash: 'abc' };
      repoMock.create.mockResolvedValue({
        ...mockRecord,
        operation: 'submitAutoRelease',
        ledgerFeedback: feedback,
      });

      const record = await service.enqueue({
        operation: 'submitAutoRelease',
        escrowId: 'escrow-1',
        errorMessage: 'tx_failed',
        ledgerFeedback: feedback,
      });

      expect(record.status).toBe('PENDING_REVIEW');
      expect(record.attempts).toBe(1);
      expect(record.ledgerFeedback).toEqual(feedback);
    });

    it('filters list() by escrowId', async () => {
      repoMock.findMany.mockResolvedValue([mockRecord]);
      repoMock.count.mockResolvedValue(1);

      const result = await service.list({ escrowId: 'escrow-123' });

      expect(result.data).toHaveLength(1);
      expect(repoMock.findMany).toHaveBeenCalledWith({
        where: { escrowId: 'escrow-123' },
        skip: 0,
        take: 20,
      });
    });

    it('stores replayedAt timestamp on successful replay', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);
      const replayed = {
        ...mockRecord,
        status: 'REPLAYED',
        lastReplayTxHash: 'new-tx-hash',
        replayedAt: new Date(),
      };
      repoMock.markReplayed.mockResolvedValue(replayed);

      const result = await service.replay('test-id-1', () =>
        Promise.resolve('new-tx-hash'),
      );

      expect(result.status).toBe('REPLAYED');
      expect(result.lastReplayTxHash).toBe('new-tx-hash');
      expect(result.replayedAt).toBeInstanceOf(Date);
    });

    it('keeps the record PENDING_REVIEW when the replay fn throws synchronously', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);
      repoMock.incrementAttempts.mockResolvedValue({ ...mockRecord });

      await expect(
        service.replay('test-id-1', () => {
          throw new Error('still failing');
        }),
      ).rejects.toThrow('still failing');

      expect(repoMock.incrementAttempts).toHaveBeenCalledWith(
        'test-id-1',
        'still failing',
      );
    });

    it('refuses to replay an abandoned record', async () => {
      const abandonedRecord = { ...mockRecord, status: 'ABANDONED' };
      repoMock.findById.mockResolvedValue(abandonedRecord);

      await expect(
        service.replay('test-id-1', () => Promise.resolve('tx')),
      ).rejects.toThrow(/not pending review/i);
    });

    it('marks the record ABANDONED with a reviewedAt timestamp', async () => {
      repoMock.findById.mockResolvedValue(mockRecord);
      const abandoned = {
        ...mockRecord,
        status: 'ABANDONED',
        reviewedAt: new Date(),
      };
      repoMock.markAbandoned.mockResolvedValue(abandoned);

      const after = await service.abandon('test-id-1');
      expect(after.status).toBe('ABANDONED');
      expect(after.reviewedAt).toBeInstanceOf(Date);
    });
  });
});
