import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository';

export interface AuditLogEntry {
  id: string;
  action: string;
  adminAddress: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  occurredAt: Date;
}

export interface AuditLogPaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedAuditLogResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class AuditLogService {
  // Issue #846: every auditLog query moved into AuditLogRepository (R-DB-02).
  constructor(private readonly auditLog: AuditLogRepository) {}

  /**
   * Appends an immutable admin action record to persistent storage.
   * No update or delete operations are exposed, enforcing an append-only audit trail.
   */
  async append(
    entry: Omit<AuditLogEntry, 'id' | 'occurredAt'>,
  ): Promise<AuditLogEntry> {
    return this.auditLog.append({
      action: entry.action,
      adminAddress: entry.adminAddress,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details,
    });
  }

  /**
   * Returns a paginated list of recorded admin actions from the database.
   * Actions are ordered newest first (occurredAt: 'desc').
   * Out-of-range or non-numeric pagination parameters are clamped.
   */
  async findAll(
    query?: AuditLogPaginationQuery,
  ): Promise<PaginatedAuditLogResponse> {
    const rawPage = query?.page;
    const rawLimit = query?.limit;

    const page =
      typeof rawPage === 'number' && Number.isFinite(rawPage)
        ? Math.max(1, Math.floor(rawPage))
        : 1;

    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
        : 20;

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.auditLog.findPage({ skip, take: limit }),
      this.auditLog.count(),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }
}
