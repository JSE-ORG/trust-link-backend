import { NotFoundException } from '@nestjs/common';
import { DlqService } from '../../src/dlq/dlq.service';

describe('DlqService (#74)', () => {
  let service: DlqService;

  beforeEach(() => {
    service = new DlqService();
  });

  describe('enqueue + list + get', () => {
    it('stores the captured ledger feedback verbatim', () => {
      const record = service.enqueue({
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

      const fetched = service.get(record.id);
      expect(fetched.errorMessage).toBe('tx_failed');
    });

    it('filters list() by status, operation, and escrowId', () => {
      const a = service.enqueue({ operation: 'submitAutoRelease', escrowId: 'e1', errorMessage: 'x' });
      service.enqueue({ operation: 'recordDelivery', escrowId: 'e2', errorMessage: 'y' });
      service.abandon(a.id);

      expect(service.list({ status: 'PENDING_REVIEW' })).toHaveLength(1);
      expect(service.list({ status: 'ABANDONED' })).toHaveLength(1);
      expect(service.list({ operation: 'recordDelivery' })).toHaveLength(1);
      expect(service.list({ escrowId: 'e1' })).toHaveLength(1);
    });

    it('raises NotFoundException for an unknown id', () => {
      expect(() => service.get('nope')).toThrow(NotFoundException);
    });
  });

  describe('replay', () => {
    it('marks the record REPLAYED and stores the new tx hash on success', async () => {
      const record = service.enqueue({
        operation: 'submitAutoRelease',
        escrowId: 'e1',
        errorMessage: 'transient_failure',
      });

      const replayed = await service.replay(record.id, async () => 'new-tx-hash');

      expect(replayed.status).toBe('REPLAYED');
      expect(replayed.lastReplayTxHash).toBe('new-tx-hash');
      expect(replayed.replayedAt).toBeInstanceOf(Date);
    });

    it('keeps the record PENDING_REVIEW and bumps attempts when the replay throws', async () => {
      const record = service.enqueue({
        operation: 'submitAutoRelease',
        escrowId: 'e1',
        errorMessage: 'first failure',
      });

      await expect(
        service.replay(record.id, async () => {
          throw new Error('still failing');
        }),
      ).rejects.toThrow('still failing');

      const after = service.get(record.id);
      expect(after.status).toBe('PENDING_REVIEW');
      expect(after.attempts).toBe(2);
      expect(after.errorMessage).toBe('still failing');
    });

    it('refuses to replay an already-replayed or abandoned record', async () => {
      const a = service.enqueue({ operation: 'submitAutoRelease', escrowId: 'e1', errorMessage: 'x' });
      await service.replay(a.id, async () => 'tx');
      await expect(
        service.replay(a.id, async () => 'tx2'),
      ).rejects.toThrow(/not pending review/i);

      const b = service.enqueue({ operation: 'submitAutoRelease', escrowId: 'e2', errorMessage: 'x' });
      service.abandon(b.id);
      await expect(
        service.replay(b.id, async () => 'tx3'),
      ).rejects.toThrow(/not pending review/i);
    });
  });

  describe('abandon / markReviewed', () => {
    it('marks the record ABANDONED with a reviewedAt timestamp', () => {
      const r = service.enqueue({ operation: 'recordDelivery', escrowId: 'e1', errorMessage: 'x' });
      const after = service.abandon(r.id);
      expect(after.status).toBe('ABANDONED');
      expect(after.reviewedAt).toBeInstanceOf(Date);
    });
  });
});
