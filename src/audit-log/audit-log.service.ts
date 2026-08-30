import { Injectable } from '@nestjs/common';

export interface AuditLogEntry {
  id: string;
  action: string;
  adminAddress: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  occurredAt: Date;
}

@Injectable()
export class AuditLogService {
  private readonly log: AuditLogEntry[] = [];
  private nextId = 1;

  /**
   * Appends an immutable admin action record. No update or delete operations
   * are exposed, enforcing an append-only audit trail.
   */
  append(entry: Omit<AuditLogEntry, 'id' | 'occurredAt'>): AuditLogEntry {
    const record: AuditLogEntry = {
      ...entry,
      id: String(this.nextId++),
      occurredAt: new Date(),
    };
    this.log.push(record);
    return record;
  }

  /**
   * Returns a snapshot copy of every recorded admin action, oldest first.
   *
   * The array is a shallow copy, so a caller cannot mutate the audit trail
   * through the returned reference (the entry objects themselves are shared,
   * not cloned). The store is in-memory and per-process: it is not persisted
   * and does not survive a restart, and in a multi-replica deployment each
   * replica sees only its own actions.
   */
  findAll(): AuditLogEntry[] {
    return [...this.log];
  }
}
