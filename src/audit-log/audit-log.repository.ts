import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogEntry } from './audit-log.service';

export interface AppendAuditLogInput {
  action: string;
  adminAddress: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}

/** Maps a stored row onto the service's {@link AuditLogEntry} shape. */
function toAuditLogEntry(record: {
  id: string;
  action: string;
  adminAddress: string;
  entityType: string;
  entityId: string;
  details: unknown;
  occurredAt: Date;
}): AuditLogEntry {
  return {
    id: record.id,
    action: record.action,
    adminAddress: record.adminAddress,
    entityType: record.entityType,
    entityId: record.entityId,
    details: (record.details as Record<string, unknown>) ?? {},
    occurredAt: record.occurredAt,
  };
}

/**
 * Owns every `auditLog` query (R-DB-02, issue #846).
 *
 * The repository exposes writes and reads only — no update, no delete — so
 * the append-only guarantee of the audit trail is enforced where the queries
 * live, not just by the service that happens to call it today.
 */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Appends an immutable admin action record. */
  async append(input: AppendAuditLogInput): Promise<AuditLogEntry> {
    const record = await this.prisma.auditLog.create({
      data: {
        action: input.action,
        adminAddress: input.adminAddress,
        entityType: input.entityType,
        entityId: input.entityId,
        details: (input.details ?? {}) as Prisma.InputJsonValue,
      },
    });

    return toAuditLogEntry(record);
  }

  /** Returns audit records newest first, for one page of the admin view. */
  async findPage(options: {
    skip: number;
    take: number;
  }): Promise<AuditLogEntry[]> {
    const records = await this.prisma.auditLog.findMany({
      skip: options.skip,
      take: options.take,
      orderBy: { occurredAt: 'desc' },
    });
    return records.map(toAuditLogEntry);
  }

  /** Counts every recorded action, for the page count alongside a page. */
  count(): Promise<number> {
    return this.prisma.auditLog.count();
  }
}
