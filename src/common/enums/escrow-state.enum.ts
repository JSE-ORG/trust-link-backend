/**
 * Canonical escrow lifecycle states (issue #239).
 *
 * These values mirror the `EscrowState` enum in `prisma/schema.prisma` exactly,
 * so DTO `@IsEnum(EscrowStateEnum)` validation rejects any value the database
 * would reject. Keep this in sync with the Prisma schema and the
 * `EscrowState` string-union type in `prisma.service.ts`.
 */
export enum EscrowStateEnum {
  CREATED = 'CREATED',
  FUNDED = 'FUNDED',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  RELEASED = 'RELEASED',
  DISPUTED = 'DISPUTED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

/**
 * Dispute lifecycle states (issue #239), mirroring the `DisputeStatus` enum in
 * `prisma/schema.prisma`.
 */
export enum DisputeStatusEnum {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
  ABANDONED = 'ABANDONED',
}
