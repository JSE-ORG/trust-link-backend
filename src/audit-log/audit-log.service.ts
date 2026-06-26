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

  /** Returns all recorded admin actions in insertion order. */
  findAll(): AuditLogEntry[] {
    return [...this.log];
  }
}
