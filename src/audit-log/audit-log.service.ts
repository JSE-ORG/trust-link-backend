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
  action?: string;
  entityType?: string;
  entityId?: string;
  adminAddress?: string;
  from?: string;
  to?: string;
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
   * Supports filtering by action, entityType, entityId, adminAddress, and date range.
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

    // Build filters
    const filters: Record<string, unknown> = {};
    if (query?.action) filters.action = query.action;
    if (query?.entityType) filters.entityType = query.entityType;
    if (query?.entityId) filters.entityId = query.entityId;
    if (query?.adminAddress) filters.adminAddress = query.adminAddress;

    const dateFilter: Record<string, unknown> = {};
    if (query?.from) {
      dateFilter.gte = new Date(query.from);
    }
    if (query?.to) {
      dateFilter.lte = new Date(query.to);
    }
    if (Object.keys(dateFilter).length > 0) {
      filters.occurredAt = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.auditLog.findPage({ skip, take: limit, where: filters }),
      this.auditLog.count(filters),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }
}
