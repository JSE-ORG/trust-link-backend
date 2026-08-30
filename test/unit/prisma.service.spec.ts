import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ensureVendors } from '../prisma-helpers';
import {
  PrismaService,
  toDisputeRecord,
  toEscrowRecord,
  toFailedTransactionRecord,
  toVendorAccountDetailsRecord,
  toVendorTrackingSettingsRecord,
} from '../../src/prisma/prisma.service';

describe('PrismaService real database operations', () => {
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    // Escrow.vendorAddress is a foreign key onto VendorProfile.address, so the
    // parent rows must exist before any escrow can be written (#475).
    await ensureVendors(prisma, 'v', 'v1', 'v2');
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  it('create/findUnique/findMany/update for escrow and updateMany behavior', async () => {
    const baseDate = new Date('2026-01-01T00:00:00.000Z');
    await prisma.escrow.create({
      data: {
        id: 'e1',
        itemName: 'A',
        itemRef: 'r1',
        amount: 1,
        currency: 'USD',
        buyerAddress: 'b1',
        vendorAddress: 'v1',
        createdAt: new Date(baseDate.getTime() + 1000),
      },
    });
    await prisma.escrow.create({
      data: {
        id: 'e2',
        itemName: 'B',
        itemRef: 'r2',
        amount: 2,
        currency: 'USD',
        buyerAddress: 'b1',
        vendorAddress: 'v1',
        createdAt: new Date(baseDate.getTime() + 2000),
      },
    });
    await prisma.escrow.create({
      data: {
        id: 'e3',
        itemName: 'C',
        itemRef: 'r3',
        amount: 3,
        currency: 'USD',
        buyerAddress: 'b2',
        vendorAddress: 'v1',
        createdAt: new Date(baseDate.getTime() + 3000),
      },
    });
    await prisma.escrow.create({
      data: {
        id: 'e4',
        itemName: 'D',
        itemRef: 'r4',
        amount: 4,
        currency: 'USD',
        buyerAddress: 'b2',
        vendorAddress: 'v2',
        createdAt: new Date(baseDate.getTime() + 4000),
      },
    });

    const found = await prisma.escrow.findUnique({ where: { id: 'e2' } });
    expect(found).not.toBeNull();
    expect(found!.id).toBe('e2');

    const results = await prisma.escrow.findMany({
      where: { vendorAddress: 'v1' },
      orderBy: { createdAt: 'asc' },
      skip: 1,
      take: 2,
    });
    expect(results.map((r) => r.id)).toEqual(['e2', 'e3']);

    const cursorResults = await prisma.escrow.findMany({
      where: { vendorAddress: 'v1' },
      orderBy: { createdAt: 'asc' },
      cursor: { id: 'e1' },
      skip: 1,
    });
    expect(cursorResults.map((r) => r.id)).toEqual(['e2', 'e3']);

    const res = await prisma.escrow.updateMany({
      where: { id: 'e2' },
      data: { autoReleaseSubmittedAt: new Date() },
    });
    expect(res.count).toBe(1);

    const res0 = await prisma.escrow.updateMany({
      where: { id: 'nope' },
      data: { autoReleaseSubmittedAt: new Date() },
    });
    expect(res0.count).toBe(0);
  });

  it('dispute.create creates a dispute linked to an escrow', async () => {
    await prisma.escrow.create({
      data: {
        id: 'e10',
        itemName: 'X',
        itemRef: 'rx',
        amount: 5,
        currency: 'USD',
        buyerAddress: 'b',
        vendorAddress: 'v',
        createdAt: new Date(),
      },
    });
    const dispute = await prisma.dispute.create({
      data: {
        escrowId: 'e10',
        reason: 'reason',
        description: 'd',
        evidenceUrls: [],
      },
    });
    expect(dispute.escrowId).toBe('e10');
  });

  it('reset clears all stores', async () => {
    await prisma.escrow.create({
      data: {
        id: 'to-delete',
        itemName: 'ToDel',
        itemRef: 'r',
        amount: 1,
        currency: 'USD',
        buyerAddress: 'b',
        vendorAddress: 'v',
      },
    });
    await prisma.reset();
    const e = await prisma.escrow.findUnique({ where: { id: 'to-delete' } });
    expect(e).toBeNull();
  });

  it('update and findMany for notification works', async () => {
    await prisma.escrow.create({
      data: {
        id: 'e-nt',
        itemName: 'N',
        itemRef: 'nr',
        amount: 10,
        currency: 'USD',
        buyerAddress: 'b',
        vendorAddress: 'v',
      },
    });
    const n = await prisma.notification.create({
      data: {
        escrowId: 'e-nt',
        type: 'FUNDED',
        channel: 'EMAIL',
        recipientAddress: 'r',
        message: 'msg',
      },
    });
    const updated = await prisma.notification.update({
      where: { id: n.id },
      data: { status: 'SENT', retryCount: 1 },
    });
    expect(updated.status).toBe('SENT');

    const all = await prisma.notification.findMany();
    expect(all.map((x) => x.id)).toContain(n.id);
  });

  it('vendorProfile upsert and update behaves as expected', async () => {
    const created = await prisma.vendorProfile.upsert({
      where: { address: 'v1' },
      create: {
        address: 'v1',
        businessName: 'B1',
        email: null,
        phone: null,
        description: null,
      },
      update: { businessName: 'B2' },
    });
    expect(created.address).toBe('v1');

    const updated = await prisma.vendorProfile.update({
      where: { address: 'v1' },
      data: { businessName: 'B3' },
    });
    expect(updated.businessName).toBe('B3');
  });

  it('processedWebhookEvent create/findUnique/delete works', async () => {
    const p = await prisma.processedWebhookEvent.create({
      data: { operationId: 'op-1' },
    });
    expect(p.operationId).toBe('op-1');
    const found = await prisma.processedWebhookEvent.findUnique({
      where: { operationId: 'op-1' },
    });
    expect(found).not.toBeNull();
    const deleted = await prisma.processedWebhookEvent.delete({
      where: { operationId: 'op-1' },
    });
    expect(deleted.operationId).toBe('op-1');
    const foundAfter = await prisma.processedWebhookEvent.findUnique({
      where: { operationId: 'op-1' },
    });
    expect(foundAfter).toBeNull();
  });

  it('refresh token create works', async () => {
    const t1 = await prisma.refreshToken.create({
      data: {
        userId: 'u1',
        tokenHash: 'h1',
        parentTokenId: null,
        revoked: false,
        expiresAt: new Date(),
      },
    });
    expect(t1.id).toBeDefined();
    expect(t1.revoked).toBe(false);
  });

  it('nonce create and findUnique works', async () => {
    const n1 = await prisma.nonce.create({
      data: {
        nonce: 'n1',
        walletAddress: 'w1',
        challenge: 'c',
        used: false,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    expect(n1.id).toBeDefined();
    expect(n1.nonce).toBe('n1');
  });

  it('failedTransaction create/findMany/update works', async () => {
    const f = await prisma.failedTransaction.create({
      data: {
        operation: 'op',
        escrowId: null,
        errorMessage: 'err',
        ledgerFeedback: Prisma.DbNull,
        attempts: 0,
        status: 'PENDING_REVIEW',
      },
    });
    const found = await prisma.failedTransaction.findMany();
    expect(found.map((r) => r.id)).toContain(f.id);
    const updated = await prisma.failedTransaction.update({
      where: { id: f.id },
      data: { errorMessage: 'new' },
    });
    expect(updated.errorMessage).toBe('new');
  });
});

// ── Configuration and safety guards (issue #702) ─────────────────────────────
//
// The suite above exercises PrismaService as a database client. What it never
// touches is the logic wrapped *around* that client: the connection-string
// rewriting in the constructor, the slow-query threshold, and the guard that
// stops reset() wiping a non-test database.
//
// None of that needs a live database — constructing the service does not
// connect — so these run against stubs. reset() in particular is stubbed
// deliberately: a test that verified the guard by letting the truncate through
// would be a test that truncates a database to prove it should not.

describe('PrismaService configuration and guards (issue #702)', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  describe('connection string', () => {
    it('prefers the constructor argument over DATABASE_URL', () => {
      process.env.DATABASE_URL = 'postgresql://env:env@envhost:5432/envdb';

      const svc = new PrismaService('postgresql://arg:arg@arghost:5432/argdb');

      expect(svc.effectiveDatabaseUrl).toContain('arghost');
      expect(svc.effectiveDatabaseUrl).not.toContain('envhost');
    });

    it('falls back to DATABASE_URL when no argument is given', () => {
      process.env.DATABASE_URL = 'postgresql://env:env@envhost:5432/envdb';

      const svc = new PrismaService();

      expect(svc.effectiveDatabaseUrl).toContain('envhost');
    });

    it('falls back to the local test database when neither is set', () => {
      delete process.env.DATABASE_URL;

      const svc = new PrismaService();

      expect(svc.effectiveDatabaseUrl).toContain(
        'localhost:5432/trustlink_test',
      );
    });

    it('applies the default 30s statement timeout when QUERY_TIMEOUT_MS is unset', () => {
      delete process.env.QUERY_TIMEOUT_MS;

      const svc = new PrismaService('postgresql://u:p@h:5432/d');

      const params = new URL(svc.effectiveDatabaseUrl!).searchParams;
      expect(params.get('statement_timeout')).toBe('30000');
      expect(params.get('connect_timeout')).toBe('10');
    });

    it('honours QUERY_TIMEOUT_MS when it is set', () => {
      process.env.QUERY_TIMEOUT_MS = '5000';

      const svc = new PrismaService('postgresql://u:p@h:5432/d');

      expect(
        new URL(svc.effectiveDatabaseUrl!).searchParams.get(
          'statement_timeout',
        ),
      ).toBe('5000');
    });

    it('overrides a statement_timeout already present in the URL', () => {
      process.env.QUERY_TIMEOUT_MS = '5000';

      const svc = new PrismaService(
        'postgresql://u:p@h:5432/d?statement_timeout=1',
      );

      const params = new URL(svc.effectiveDatabaseUrl!).searchParams;
      expect(params.getAll('statement_timeout')).toEqual(['5000']);
    });

    it('uses an unparseable connection string as-is instead of throwing', () => {
      // Some deployments pass a DSN-style string that is not a WHATWG URL.
      // Rewriting is a best-effort optimisation; failing to parse must not
      // take the whole application down at construction time.
      const raw = 'host=localhost port=5432 dbname=trustlink';

      const svc = new PrismaService(raw);

      expect(svc.effectiveDatabaseUrl).toBe(raw);
    });
  });

  describe('slow-query logging', () => {
    async function initWithQueryHook(
      svc: PrismaService,
    ): Promise<(event: { duration: number; query: string }) => void> {
      jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
      const handlers: Array<(event: unknown) => void> = [];
      Object.defineProperty(svc, '$on', {
        value: jest.fn((_event: string, cb: (event: unknown) => void) => {
          handlers.push(cb);
        }),
        configurable: true,
        writable: true,
      });

      await svc.onModuleInit();

      return handlers[0];
    }

    it('warns for a query at or above the default 500ms threshold', async () => {
      delete process.env.SLOW_QUERY_THRESHOLD_MS;
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const onQuery = await initWithQueryHook(svc);
      // Exactly at the threshold: the comparison is >=, and a boundary that
      // silently flipped to > would hide the queries sitting right on the limit.
      onQuery({ duration: 500, query: 'SELECT 1' });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Slow query (500ms)'),
      );
    });

    it('stays quiet for a query below the threshold', async () => {
      delete process.env.SLOW_QUERY_THRESHOLD_MS;
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const onQuery = await initWithQueryHook(svc);
      onQuery({ duration: 499, query: 'SELECT 1' });

      expect(warn).not.toHaveBeenCalled();
    });

    it('honours SLOW_QUERY_THRESHOLD_MS when it is set', async () => {
      process.env.SLOW_QUERY_THRESHOLD_MS = '10';
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const onQuery = await initWithQueryHook(svc);
      onQuery({ duration: 20, query: 'SELECT 2' });
      onQuery({ duration: 5, query: 'SELECT 3' });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Slow query (20ms)'),
      );
    });

    it('connects before registering the query hook', async () => {
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
      Object.defineProperty(svc, '$on', {
        value: jest.fn(),
        configurable: true,
        writable: true,
      });

      await svc.onModuleInit();

      expect(connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset() NODE_ENV guard', () => {
    // Stubbed rather than live: the point of the guard is that reset() destroys
    // data, so the test must never reach the truncate to prove it.
    function stubReset(svc: PrismaService, tablenames: string[]) {
      const executed: string[] = [];
      Object.defineProperty(svc, '$queryRaw', {
        value: jest
          .fn()
          .mockResolvedValue(tablenames.map((tablename) => ({ tablename }))),
        configurable: true,
        writable: true,
      });
      Object.defineProperty(svc, '$transaction', {
        value: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
          await fn({
            $executeRawUnsafe: jest.fn((sql: string) => {
              executed.push(sql);
              return Promise.resolve(0);
            }),
          });
        }),
        configurable: true,
        writable: true,
      });
      return executed;
    }

    it('refuses to run when NODE_ENV is not test', async () => {
      process.env.NODE_ENV = 'production';
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const executed = stubReset(svc, ['escrow']);

      await expect(svc.reset()).rejects.toThrow(
        /test-only helper.*NODE_ENV=test.*production/s,
      );
      expect(executed).toEqual([]);
    });

    it('names NODE_ENV as undefined rather than interpolating nothing', async () => {
      delete process.env.NODE_ENV;
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      stubReset(svc, ['escrow']);

      await expect(svc.reset()).rejects.toThrow('current: undefined');
    });

    it('runs when NODE_ENV is test, skipping _prisma_migrations', async () => {
      process.env.NODE_ENV = 'test';
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const executed = stubReset(svc, [
        'escrow',
        '_prisma_migrations',
        'dispute',
      ]);

      await svc.reset();

      const truncate = executed.find((sql) => sql.startsWith('TRUNCATE'));
      expect(truncate).toBe('TRUNCATE TABLE "escrow", "dispute" CASCADE;');
      // Dropping the migration history would make the next `prisma migrate`
      // replay every migration against a populated schema.
      expect(truncate).not.toContain('_prisma_migrations');
      expect(executed[0]).toContain('pg_advisory_xact_lock(42)');
    });

    it('issues no transaction when there is nothing to truncate', async () => {
      process.env.NODE_ENV = 'test';
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const executed = stubReset(svc, ['_prisma_migrations']);

      await svc.reset();

      // An empty table list would build `TRUNCATE TABLE  CASCADE`, which is a
      // syntax error, so the guard has to skip the transaction entirely.
      expect(executed).toEqual([]);
    });
  });

  describe('onModuleDestroy()', () => {
    it('disconnects the client', async () => {
      const svc = new PrismaService('postgresql://u:p@h:5432/d');
      const disconnect = jest
        .spyOn(svc, '$disconnect')
        .mockResolvedValue(undefined);

      await svc.onModuleDestroy();

      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Boundary mappers (issue #702) ────────────────────────────────────────────
//
// Each mapper carries a coalesce or a cast that only shows up on a row the
// repository tests never produce: Prisma types a nullable Json column as
// `JsonValue | null`, but the driver returns `undefined` for a column that was
// not selected. Without the `?? null` those reach consumers as `undefined`,
// which fails `=== null` checks everywhere downstream.

describe('PrismaService boundary mappers (issue #702)', () => {
  it('converts an escrow Decimal amount to a number', () => {
    const row = { id: 'e1', amount: { toString: () => '12.5' } };

    // A Decimal is not a number: arithmetic on it silently produces a string
    // concatenation or NaN further down.
    expect(toEscrowRecord(row as never).amount).toBe(12.5);
  });

  it('narrows a dispute status string to the DisputeState union', () => {
    const row = { id: 'd1', status: 'RESOLVED' };

    expect(toDisputeRecord(row as never).status).toBe('RESOLVED');
  });

  it.each([
    ['a populated object', { code: 'tx_failed' }, { code: 'tx_failed' }],
    ['an explicit null', null, null],
    ['an unselected column', undefined, null],
  ])(
    'maps failedTransaction.ledgerFeedback from %s',
    (_label, input, expected) => {
      const row = { id: 'f1', status: 'PENDING_REVIEW', ledgerFeedback: input };

      expect(toFailedTransactionRecord(row as never).ledgerFeedback).toEqual(
        expected,
      );
    },
  );

  it.each([
    ['a populated object', { tier: 'gold' }, { tier: 'gold' }],
    ['an explicit null', null, null],
    ['an unselected column', undefined, null],
  ])(
    'maps vendorAccountDetails.customFields from %s',
    (_label, input, expected) => {
      const row = { id: 'v1', customFields: input };

      expect(toVendorAccountDetailsRecord(row as never).customFields).toEqual(
        expected,
      );
    },
  );

  it.each([
    ['a populated object', { carrier: 'dhl' }, { carrier: 'dhl' }],
    ['an explicit null', null, null],
    ['an unselected column', undefined, null],
  ])(
    'maps vendorTrackingSettings.customTrackingRules from %s',
    (_label, input, expected) => {
      const row = { id: 't1', customTrackingRules: input };

      expect(
        toVendorTrackingSettingsRecord(row as never).customTrackingRules,
      ).toEqual(expected);
    },
  );
});
