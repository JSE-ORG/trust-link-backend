import { FailedTransactionRepository } from './failed-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('FailedTransactionRepository', () => {
  let repo: FailedTransactionRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    // State lives in a shared database, not a per-instance Map, so a suite
    // that does not clear it inherits whatever the previous file left behind
    // (#475).
    await prisma.reset();
    repo = new FailedTransactionRepository(prisma);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool; leaving them
    // open across ~100 suites exhausts Postgres.
    await prisma?.$disconnect();
  });

  const seed = (overrides: Record<string, unknown> = {}) =>
    repo.create({
      operation: 'submitTransaction',
      errorMessage: 'tx failed',
      ...overrides,
    });

  describe('create()', () => {
    it('stores a new row as PENDING_REVIEW with a single attempt', async () => {
      const record = await seed({ escrowId: 'escrow-1' });

      expect(record.status).toBe('PENDING_REVIEW');
      expect(record.attempts).toBe(1);
      expect(record.escrowId).toBe('escrow-1');
    });

    it('keeps ledgerFeedback verbatim when supplied', async () => {
      const feedback = { resultCodes: ['op_underfunded'], hash: 'abc' };
      const record = await seed({ ledgerFeedback: feedback });

      expect(record.ledgerFeedback).toEqual(feedback);
    });

    it('stores SQL NULL (not the JSON literal null) when feedback is omitted', async () => {
      const record = await seed();

      const row = await prisma.failedTransaction.findUnique({
        where: { id: record.id },
      });
      expect(row?.ledgerFeedback).toBeNull();
    });

    it('defaults escrowId to null for a failure not tied to an escrow', async () => {
      const record = await seed();

      expect(record.escrowId).toBeNull();
    });
  });

  describe('findById()', () => {
    it('returns the stored row', async () => {
      const created = await seed();

      const found = await repo.findById(created.id);

      expect(found?.id).toBe(created.id);
      expect(found?.operation).toBe('submitTransaction');
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.findById('does-not-exist')).toBeNull();
    });
  });

  describe('findMany() / count()', () => {
    it('returns rows newest first', async () => {
      const older = await repo.create({
        operation: 'older',
        errorMessage: 'e',
      });
      // createdAt has second-granularity defaults in the schema, so nudge the
      // newer row forward explicitly rather than relying on insert timing.
      const newer = await seed({ operation: 'newer' });
      await prisma.failedTransaction.update({
        where: { id: newer.id },
        data: { createdAt: new Date(older.createdAt.getTime() + 60_000) },
      });

      const rows = await repo.findMany({});

      expect(rows.map((r) => r.operation)).toEqual(['newer', 'older']);
    });

    it('applies the status filter', async () => {
      const pending = await seed();
      await repo.markAbandoned(pending.id);

      const rows = await repo.findMany({ where: { status: 'PENDING_REVIEW' } });

      expect(rows.map((r) => r.id)).not.toContain(pending.id);
      expect(await repo.count({ status: 'PENDING_REVIEW' })).toBe(0);
    });

    it('applies the escrowId filter', async () => {
      await seed({ escrowId: 'escrow-1' });
      await seed({ escrowId: 'escrow-2' });

      const rows = await repo.findMany({ where: { escrowId: 'escrow-1' } });

      expect(rows).toHaveLength(1);
      expect(rows[0].escrowId).toBe('escrow-1');
    });

    it('paginates with skip and take', async () => {
      for (let i = 0; i < 3; i++) {
        await seed({ errorMessage: `failure ${i}` });
      }

      const page = await repo.findMany({ skip: 1, take: 1 });

      expect(page).toHaveLength(1);
      expect(await repo.count({})).toBe(3);
    });
  });

  describe('incrementAttempts()', () => {
    it('bumps attempts, records the error, and leaves the status alone', async () => {
      const record = await seed();

      const updated = await repo.incrementAttempts(record.id, 'replay blew up');

      expect(updated.attempts).toBe(2);
      expect(updated.errorMessage).toBe('replay blew up');
      expect(updated.status).toBe('PENDING_REVIEW');
    });
  });

  describe('markReplayed()', () => {
    it('marks the row REPLAYED with the tx hash and a replayedAt stamp', async () => {
      const record = await seed();

      const updated = await repo.markReplayed(record.id, 'tx-hash-abc');

      expect(updated.status).toBe('REPLAYED');
      expect(updated.lastReplayTxHash).toBe('tx-hash-abc');
      expect(updated.replayedAt).toBeInstanceOf(Date);
    });
  });

  describe('markAbandoned()', () => {
    it('marks the row ABANDONED with a reviewedAt stamp', async () => {
      const record = await seed();

      const updated = await repo.markAbandoned(record.id);

      expect(updated.status).toBe('ABANDONED');
      expect(updated.reviewedAt).toBeInstanceOf(Date);
    });
  });

  describe('markReviewed()', () => {
    it('stamps reviewedAt without changing the status', async () => {
      const record = await seed();

      const updated = await repo.markReviewed(record.id);

      expect(updated.status).toBe('PENDING_REVIEW');
      expect(updated.reviewedAt).toBeInstanceOf(Date);
    });
  });
});
