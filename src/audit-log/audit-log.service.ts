import { buildPaginatedEnvelope } from '../common/pagination/pagination.helper';
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
  totalPages: number;
  hasNextPage: boolean;
}

/**
 * Escapes leading formula trigger characters (=, +, -, @, \t, \r)
 * by prefixing them with a single quote to prevent CSV injection.
 */
function escapeCsvFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Converts any value to a CSV-safe cell string:
 * - Details/objects are serialized to JSON
 * - Dates are ISO formatted
 * - Formula characters are escaped
 * - Strings with commas, double quotes, or newlines are quoted
 */
function toCsvValue(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }
  let str: string;
  let isObject = false;
  if (val instanceof Date) {
    str = val.toISOString();
  } else if (typeof val === 'object') {
    str = JSON.stringify(val);
    isObject = true;
  } else if (typeof val === 'string') {
    str = val;
  } else if (
    typeof val === 'number' ||
    typeof val === 'boolean' ||
    typeof val === 'bigint'
  ) {
    str = val.toString();
  } else {
    str = '';
  }

  str = escapeCsvFormula(str);

  if (isObject || /[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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

    return buildPaginatedEnvelope(data, total, page, limit);
  }

  /**
   * Exports up to 50,000 audit log records matching the specified filters as a CSV string.
   * Details are serialized as JSON in one column, and formula injection is escaped.
   */
  async exportCsv(query?: AuditLogPaginationQuery): Promise<string> {
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

    const data = await this.auditLog.findPage({
      skip: 0,
      take: 50000,
      where: filters,
    });

    const header =
      'id,action,adminAddress,entityType,entityId,details,occurredAt';
    const rows = data.map((entry) =>
      [
        toCsvValue(entry.id),
        toCsvValue(entry.action),
        toCsvValue(entry.adminAddress),
        toCsvValue(entry.entityType),
        toCsvValue(entry.entityId),
        toCsvValue(entry.details),
        toCsvValue(entry.occurredAt),
      ].join(','),
    );

    return [header, ...rows].join('\n');
  }
}
