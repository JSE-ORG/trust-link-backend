import { DisputeRecord, EscrowRecord } from '../prisma/prisma.service';
import type { EscrowSummaryDto } from './dto/escrow-summary.dto';

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
 * A single lifecycle event for an escrow.
 *
 * - `event`: the lifecycle state name (e.g. `CREATED`, `SHIPPED`).
 * - `occurredAt`: when the transition was recorded.
 * - `fromState`: the state before the transition (null for the initial event).
 * - `toState`: the state after the transition.
 */
export interface EscrowEventEntry {
  event: string;
  occurredAt: Date;
  fromState: string | null;
  toState: string;
}

/**
 * Result of {@link EscrowRepository.findEvents}: the chronological lifecycle
 * history derived from an escrow's timestamp fields.
 */
export type EventsResult = EscrowEventEntry[];

/** Optional filters for escrow list queries. Unset fields are ignored. */
export interface EscrowListFilter {
  vendorAddress?: string;
  buyerAddress?: string;
  state?: string;
  /** Earliest `createdAt`, inclusive (ISO 8601). */
  from?: string;
  /** Latest `createdAt`, inclusive. A date-only value covers the whole day. */
  to?: string;
  /** Case-insensitive match on `itemName` or `itemRef`. */
  q?: string;
}

/** Result of {@link EscrowRepository.findByIdWithDispute}. */
export interface EscrowWithDispute {
  escrow: EscrowRecord;
  dispute: DisputeRecord | null;
}

/** Query accepted by the vendor and buyer escrow lists. */
export interface EscrowListQuery extends Omit<
  EscrowListFilter,
  'vendorAddress'
> {
  sort?: 'date' | 'amount';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** One page of escrow summaries plus the unpaginated total. */
export interface EscrowListPage {
  data: EscrowSummaryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}
