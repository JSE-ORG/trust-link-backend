import { AuditLogRepository } from './audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditLogRepository', () => {
  let repo: AuditLogRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    // State lives in a shared database, not a per-instance Map, so a suite
    // that does not clear it inherits whatever the previous file left behind
    // (#475).
    await prisma.reset();
    repo = new AuditLogRepository(prisma);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool; leaving them
    // open across ~100 suites exhausts Postgres.
    await prisma?.$disconnect();
  });

  const entry = (overrides: Record<string, unknown> = {}) => ({
    action: 'DISPUTE_RESOLVED',
    adminAddress: 'GADMIN',
    entityType: 'escrow',
    entityId: 'escrow-1',
    details: { resolution: 'RELEASE' },
    ...overrides,
  });

  describe('append()', () => {
    it('stores the entry and returns it with its id and timestamp', async () => {
      const created = await repo.append(entry());

      expect(created.id).toBeDefined();
      expect(created.action).toBe('DISPUTE_RESOLVED');
      expect(created.details).toEqual({ resolution: 'RELEASE' });
      expect(created.occurredAt).toBeInstanceOf(Date);
    });

    it('defaults missing details to an empty object', async () => {
      const created = await repo.append(
        entry({ details: undefined as unknown as Record<string, unknown> }),
      );

      expect(created.details).toEqual({});
    });

    it('round-trips details through JSONB', async () => {
      const created = await repo.append(
        entry({ details: { nested: { ok: true }, list: [1, 2] } }),
      );

      const row = await prisma.auditLog.findUnique({
        where: { id: created.id },
      });
      expect(row?.details).toEqual({ nested: { ok: true }, list: [1, 2] });
    });
  });

  describe('findPage() / count()', () => {
    it('returns entries newest first', async () => {
      const older = await repo.append(entry({ action: 'OLDER' }));
      const newer = await repo.append(entry({ action: 'NEWER' }));
      await prisma.auditLog.update({
        where: { id: newer.id },
        data: { occurredAt: new Date(older.occurredAt.getTime() + 60_000) },
      });

      const page = await repo.findPage({ skip: 0, take: 20 });

      expect(page.map((r) => r.action)).toEqual(['NEWER', 'OLDER']);
      expect(await repo.count()).toBe(2);
    });

    it('paginates with skip and take', async () => {
      for (let i = 0; i < 3; i++) {
        await repo.append(entry({ action: `ACTION_${i}` }));
      }

      const page = await repo.findPage({ skip: 1, take: 1 });

      expect(page).toHaveLength(1);
      expect(await repo.count()).toBe(3);
    });
  });

  describe('append-only surface', () => {
    it('exposes no update or delete method', () => {
      const surface = repo as unknown as Record<string, unknown>;

      expect(surface.update).toBeUndefined();
      expect(surface.delete).toBeUndefined();
      expect(surface.remove).toBeUndefined();
    });
  });
});
