import { NotFoundException } from '@nestjs/common';
import { DlqService } from '../../src/dlq/dlq.service';

describe('DlqService (#74)', () => {
  let service: DlqService;
  let prismaMock: {
    failedTransaction: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const mockRecord = {
    id: 'test-id-1',
    operation: 'submitAutoRelease',
    escrowId: 'escrow-1',
    errorMessage: 'tx_failed',
    ledgerFeedback: { resultCodes: ['op_underfunded'], hash: 'abc' },
    attempts: 1,
    status: 'PENDING_REVIEW',
    lastReplayTxHash: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    reviewedAt: null,
    replayedAt: null,
  };

  beforeEach(() => {
    prismaMock = {
      failedTransaction: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new DlqService(prismaMock as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueue + list + get', () => {
    it('stores the captured ledger feedback verbatim', async () => {
      prismaMock.failedTransaction.create.mockResolvedValue(mockRecord);

      const record = await service.enqueue({
        operation: 'submitAutoRelease',
        escrowId: 'escrow-1',
        errorMessage: 'tx_failed',
        ledgerFeedback: { resultCodes: ['op_underfunded'], hash: 'abc' },
      });

      expect(record.status).toBe('PENDING_REVIEW');
      expect(record.attempts).toBe(1);
      expect(record.ledgerFeedback).toEqual({
        resultCodes: ['op_underfunded'],
        hash: 'abc',
      });

      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      const fetched = await service.get(record.id);
      expect(fetched.errorMessage).toBe('tx_failed');
    });

    it('filters list() by status, operation, and escrowId', async () => {
      const a = {
        ...mockRecord,
        id: 'a',
        status: 'ABANDONED',
        reviewedAt: new Date(),
      };
      prismaMock.failedTransaction.create.mockResolvedValue(mockRecord);
      await service.enqueue({
        operation: 'submitAutoRelease',
        escrowId: 'e1',
        errorMessage: 'x',
      });

      prismaMock.failedTransaction.create.mockResolvedValue({
        ...mockRecord,
        id: 'b',
        operation: 'recordDelivery',
        escrowId: 'e2',
      });
      await service.enqueue({
        operation: 'recordDelivery',
        escrowId: 'e2',
        errorMessage: 'y',
      });

      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      prismaMock.failedTransaction.update.mockResolvedValue(a);
      await service.abandon('a');

      prismaMock.failedTransaction.findMany.mockResolvedValue([mockRecord]);
      expect(await service.list({ status: 'PENDING_REVIEW' })).toHaveLength(1);

      prismaMock.failedTransaction.findMany.mockResolvedValue([a]);
      expect(await service.list({ status: 'ABANDONED' })).toHaveLength(1);

      prismaMock.failedTransaction.findMany.mockResolvedValue([
        { ...mockRecord, operation: 'recordDelivery' },
      ]);
      expect(await service.list({ operation: 'recordDelivery' })).toHaveLength(
        1,
      );

      prismaMock.failedTransaction.findMany.mockResolvedValue([mockRecord]);
      expect(await service.list({ escrowId: 'e1' })).toHaveLength(1);
    });

    it('raises NotFoundException for an unknown id', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('replay', () => {
    it('marks the record REPLAYED and stores the new tx hash on success', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      const replayed = {
        ...mockRecord,
        status: 'REPLAYED',
        lastReplayTxHash: 'new-tx-hash',
        replayedAt: new Date(),
      };
      prismaMock.failedTransaction.update.mockResolvedValue(replayed);

      const result = await service.replay('test-id-1', () =>
        Promise.resolve('new-tx-hash'),
      );

      expect(result.status).toBe('REPLAYED');
      expect(result.lastReplayTxHash).toBe('new-tx-hash');
      expect(result.replayedAt).toBeInstanceOf(Date);
    });

    it('keeps the record PENDING_REVIEW and bumps attempts when the replay throws', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      prismaMock.failedTransaction.update.mockResolvedValue({});

      await expect(
        service.replay('test-id-1', () => {
          throw new Error('still failing');
        }),
      ).rejects.toThrow('still failing');

      expect(prismaMock.failedTransaction.update).toHaveBeenCalledWith({
        where: { id: 'test-id-1' },
        data: {
          attempts: { increment: 1 },
          errorMessage: 'still failing',
        },
      });
    });

    it('refuses to replay an already-replayed or abandoned record', async () => {
      const replayedRecord = { ...mockRecord, status: 'REPLAYED' };
      prismaMock.failedTransaction.findUnique.mockResolvedValue(replayedRecord);

      await expect(
        service.replay('test-id-1', () => Promise.resolve('tx')),
      ).rejects.toThrow(/not pending review/i);

      const abandonedRecord = { ...mockRecord, id: 'b', status: 'ABANDONED' };
      prismaMock.failedTransaction.findUnique.mockResolvedValue(
        abandonedRecord,
      );

      await expect(
        service.replay('b', () => Promise.resolve('tx3')),
      ).rejects.toThrow(/not pending review/i);
    });
  });

  describe('abandon / markReviewed', () => {
    it('marks the record ABANDONED with a reviewedAt timestamp', async () => {
      prismaMock.failedTransaction.findUnique.mockResolvedValue(mockRecord);
      const abandoned = {
        ...mockRecord,
        status: 'ABANDONED',
        reviewedAt: new Date(),
      };
      prismaMock.failedTransaction.update.mockResolvedValue(abandoned);

      const after = await service.abandon('test-id-1');
      expect(after.status).toBe('ABANDONED');
      expect(after.reviewedAt).toBeInstanceOf(Date);
    });
  });
});
