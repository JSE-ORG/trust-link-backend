/**
 * Tests for AuditLogRepository fallback branches (issue #1126).
 *
 * Covers: findPage with and without a where filter.
 */

import { AuditLogRepository } from './audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';

function makeAuditRow() {
  return {
    id: 'al-1',
    action: 'CREATE',
    adminAddress: 'ADMIN',
    entityType: 'escrow',
    entityId: 'e-1',
    details: { note: 'test' },
    occurredAt: new Date(),
  };
}

describe('AuditLogRepository.findPage', () => {
  it('passes where filter to Prisma when provided', async () => {
    const rows = [makeAuditRow()];
    const prisma = {
      auditLog: { findMany: jest.fn().mockResolvedValue(rows) },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new AuditLogRepository(prisma);

    const filter = { entityType: 'escrow' };
    const result = await repo.findPage({ skip: 0, take: 10, where: filter });

    expect(result).toHaveLength(1);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: filter }),
    );
  });

  it('works with no where filter', async () => {
    const prisma = {
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new AuditLogRepository(prisma);

    const result = await repo.findPage({ skip: 0, take: 5 });
    expect(result).toHaveLength(0);
  });
});
