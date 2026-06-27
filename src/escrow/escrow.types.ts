import { EscrowRecord } from '../prisma/prisma.service';

/**
 * Named return-type interfaces for {@link EscrowRepository} methods (issue #237).
 *
 * Declaring these explicitly (rather than inline object literals) documents the
 * repository contract in one place and makes it easy to swap the underlying
 * persistence implementation without touching every call site.
 */

/**
 * Result of {@link EscrowRepository.findVendorEscrows}: a single page of escrow
 * records plus the total count of matching rows before pagination was applied.
 */
export interface VendorEscrowsResult {
  /** The escrow records for the requested page. */
  data: EscrowRecord[];
  /** Total number of escrows matching the filter, ignoring `page`/`limit`. */
  total: number;
}

/**
 * Result of {@link EscrowRepository.findAutoReleaseEligible}: the set of escrows
 * eligible for auto-release at the supplied reference time.
 */
export type AutoReleaseEligibleResult = EscrowRecord[];

/**
 * A single derived lifecycle event for an escrow.
 *
 * - `event`: the lifecycle state name (e.g. `CREATED`, `SHIPPED`).
 * - `occurredAt`: when the transition was recorded.
 */
export interface EscrowEventEntry {
  event: string;
  occurredAt: Date;
}

/**
 * Result of {@link EscrowRepository.findEvents}: the chronological lifecycle
 * history derived from an escrow's timestamp fields.
 */
export type EventsResult = EscrowEventEntry[];
