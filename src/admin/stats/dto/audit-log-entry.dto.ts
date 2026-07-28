import { ApiProperty } from '@nestjs/swagger';

/**
 * Single audit log entry returned by GET /admin/audit-log. Entries are
 * appended by the AuditLogService whenever an admin performs a
 * state-changing action such as resolving a dispute.
 */
export class AuditLogEntryDto {
  @ApiProperty({
    description: 'ISO-8601 timestamp when this audit log entry was written.',
    type: String,
    format: 'date-time',
    example: '2026-05-27T09:14:00.000Z',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Stellar public key of the admin that performed the action.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  adminAddress!: string;

  @ApiProperty({
    description:
      'Action type identifier. Values are defined by AuditLogService and include DISPUTE_RESOLVED, VENDOR_SUSPENDED, etc.',
    example: 'DISPUTE_RESOLVED',
  })
  action!: string;

  @ApiProperty({
    description: 'Type of entity the action was performed against (escrow, vendor, dispute, etc.).',
    example: 'escrow',
  })
  entityType!: string;

  @ApiProperty({
    description: 'Identifier of the entity the action was performed against.',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  entityId!: string;

  @ApiProperty({
    description: 'Arbitrary structured context specific to the action type.',
    example: { resolution: 'REFUND' },
    additionalProperties: true,
    required: false,
  })
  details?: Record<string, unknown>;
}
