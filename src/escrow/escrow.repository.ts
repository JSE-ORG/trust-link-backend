import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import {
  EscrowRecord,
  EscrowState,
  PrismaService,
  toEscrowRecord,
} from '../prisma/prisma.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import {
  AUTO_RELEASE_WINDOW_HOURS,
  ESCROW_CACHE_TTL_SECONDS,
} from './escrow.constants';
import {
  AutoReleaseEligibleResult,
  EventsResult,
  VendorEscrowsResult,
} from './escrow.types';

@Injectable()
export class EscrowRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly cache?: CacheService,
  ) {}

  private cacheKey(id: string): string {
    return `escrow:${id}`;
  }

  private async invalidate(id: string): Promise<void> {
    await this.cache?.del(this.cacheKey(id));
  }

  /**
   * Invalidates the cached escrow for callers that mutate escrow state as a
   * side effect of another write (e.g. creating a dispute transitions the
   * linked escrow to DISPUTED) without going through this repository.
   */
  async invalidateCache(id: string): Promise<void> {
    await this.invalidate(id);
  }

  /** Persists a new escrow record with the given DTO fields and vendor address. */
  create(dto: CreateEscrowDto, vendorAddress: string): Promise<EscrowRecord> {
    return this.prisma.escrow
      .create({
        data: {
          id: randomUUID(),
          ...dto,
          vendorAddress,
          state: 'CREATED',
        },
      })
      .then(toEscrowRecord);
  }

  /**
   * Finds the first escrow matching both vendorAddress and itemRef,
   * used to detect duplicate submissions for the same item reference.
   * Uses findFirst (LIMIT 1) rather than findMany so only one row is
   * loaded; orderBy makes the result deterministic when duplicates exist.
   */
  findByVendorAndItem(
    vendorAddress: string,
    itemRef: string,
  ): Promise<EscrowRecord | null> {
    return this.prisma.escrow
      .findFirst({
        where: { vendorAddress, itemRef },
        orderBy: { createdAt: 'asc' },
      })
      .then((row) => (row ? toEscrowRecord(row) : null));
  }

  /**
   * Returns a cached escrow by ID (60-second Redis TTL) or falls through
   * to the database on a cache miss.
   */
  async findById(id: string): Promise<EscrowRecord | null> {
    const cached = await this.cache?.get<EscrowRecord>(this.cacheKey(id));
    if (cached) return cached;
    const row = await this.prisma.escrow.findUnique({ where: { id } });
    if (!row) return null;
    const record = toEscrowRecord(row);
    await this.cache?.set(this.cacheKey(id), record, ESCROW_CACHE_TTL_SECONDS);
    return record;
  }

  /**
   * Returns a cursor-paginated slice of escrows for the given vendor,
   * ordered newest-first. Pass `cursor` (an escrow ID) to get the page
   * after that record; omit it for the first page.
   */
  findByVendor(
    vendorAddress: string,
    cursor?: string,
    take = 20,
  ): Promise<EscrowRecord[]> {
    return this.prisma.escrow
      .findMany({
        where: { vendorAddress },
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      .then((rows) => rows.map(toEscrowRecord));
  }

  /**
   * Returns a cursor-paginated slice of escrows for the given buyer,
   * ordered newest-first. Pass `cursor` (an escrow ID) to get the page
   * after that record; omit it for the first page.
   */
  findByBuyer(
    buyerAddress: string,
    cursor?: string,
    take = 20,
  ): Promise<EscrowRecord[]> {
    return this.prisma.escrow
      .findMany({
        where: { buyerAddress },
        orderBy: { createdAt: 'desc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      .then((rows) => rows.map(toEscrowRecord));
  }

  /** Updates the escrow state and invalidates its cache entry. */
  async updateState(id: string, state: EscrowState): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /** Attaches a tracking ID to the escrow and invalidates its cache entry. */
  async updateTracking(id: string, trackingId: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { trackingId },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Returns a paginated, sorted slice of escrows for the given vendor.
   * Sorts by date or amount; returns the total count before slicing.
   *
   * @returns a {@link VendorEscrowsResult} with the page data and total count.
   */
  async findVendorEscrows(
    vendorAddress: string,
    state: string | undefined,
    sort: 'date' | 'amount',
    order: 'asc' | 'desc',
    page: number,
    limit: number,
  ): Promise<VendorEscrowsResult> {
    const where = { vendorAddress, state: state as EscrowState | undefined };
    const orderBy =
      sort === 'amount' ? { amount: order } : { createdAt: order };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.escrow.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.escrow.count({ where }),
    ]);

    return { data: data.map(toEscrowRecord), total };
  }

  /**
   * Transitions the escrow to SHIPPED, records the tracking ID and ship
   * timestamp, then invalidates the cache.
   */
  async markShipped(id: string, trackingId: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'SHIPPED', trackingId, shippedAt: new Date() },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Resolves a Soroban contract escrow id (`u64`) to the backend escrow's UUID.
   *
   * The contract mints its own identifier from an on-chain counter and the
   * backend mints a UUID, so inbound chain events carry an id this side cannot
   * use directly. `contractEscrowId` is the only join between them, and it is
   * unique, so at most one row can match. Returns null when the on-chain escrow
   * has not been mapped to a backend row yet.
   */
  async findIdByContractEscrowId(
    contractEscrowId: bigint,
  ): Promise<string | null> {
    const row = await this.prisma.escrow.findUnique({
      where: { contractEscrowId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Transitions the escrow to COMPLETED and invalidates the cache. */
  async markCompleted(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'COMPLETED' },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /** Transitions the escrow to REFUNDED and invalidates the cache. */
  async markRefunded(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'REFUNDED' },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Transitions the escrow to DELIVERED, records both delivery timestamps,
   * and invalidates the cache.
   */
  async markDelivered(
    id: string,
    deliveredAt = new Date(),
  ): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: {
        state: 'DELIVERED',
        deliveredAt,
        deliveryRecordedAt: deliveredAt,
      },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Records a submitted auto-release transaction without changing `state`.
   *
   * Submission is not confirmation. The worker knows only that the network
   * accepted the transaction; whether it lands is decided on chain, and the
   * `AutoReleased` event is what says so. Marking a terminal state here would
   * make an escrow terminal on the strength of a transaction that may still
   * fail, and would then cause `syncStateFromChain` to skip the real event as
   * `terminal_state` — taking the completion notification with it.
   *
   * `autoReleaseTxHash` alone is enough to keep the escrow out of
   * {@link findAutoReleaseEligible}, so no resubmission can follow.
   */
  async recordAutoReleaseSubmission(
    id: string,
    txHash: string,
    submittedAt = new Date(),
  ): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: {
        autoReleaseSubmittedAt: submittedAt,
        autoReleaseTxHash: txHash,
      },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Transitions the escrow to CANCELLED, records the cancellation timestamp,
   * and invalidates the cache.
   */
  async markCancelled(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: {
        state: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Returns all SHIPPED escrows that have a non-null trackingId,
   * used by the tracking poll worker to check for delivery updates.
   */
  findShippedWithTracking(): Promise<EscrowRecord[]> {
    return this.prisma.escrow
      .findMany({ where: { state: 'SHIPPED' } })
      .then((escrows) =>
        escrows
          .filter((escrow) => Boolean(escrow.trackingId))
          .map(toEscrowRecord),
      );
  }

  /**
   * Returns DELIVERED escrows whose deliveredAt is at or before
   * `referenceTime - AUTO_RELEASE_WINDOW_HOURS`, with no open dispute and no
   * existing or in-flight auto-release transaction. Callers pass the reference
   * time (normally now); this method derives the cutoff from it.
   *
   * The state predicate must stay in step with {@link markDelivered}, which is
   * the only writer of `deliveredAt` and sets `state: 'DELIVERED'` in the same
   * update. Querying any other state alongside a non-null `deliveredAt` asks
   * for a combination the application cannot produce, so the query matches
   * nothing and auto-release silently never fires (issue #395).
   *
   * @returns an {@link AutoReleaseEligibleResult} of eligible escrow records.
   */
  findAutoReleaseEligible(
    referenceTime = new Date(),
  ): Promise<AutoReleaseEligibleResult> {
    const cutoff = new Date(
      referenceTime.getTime() - AUTO_RELEASE_WINDOW_HOURS * 60 * 60 * 1000,
    );
    return this.prisma.escrow
      .findMany({
        where: {
          state: 'DELIVERED',
          deliveredAt: { lte: cutoff },
          disputeId: null,
          autoReleaseTxHash: null,
          autoReleaseSubmittedAt: null,
        },
        // Oldest delivery first, with id as a tie-break. Without an explicit
        // order Postgres may return these rows in any sequence, which makes
        // batch processing non-deterministic: which escrow is attempted first
        // (and therefore which is retried after a partial failure) would vary
        // between runs.
        orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
      })
      .then((rows) => rows.map(toEscrowRecord));
  }

  /**
   * Atomically claims an escrow for auto-release by setting autoReleaseSubmittedAt.
   */
  async markAutoReleaseSubmitting(id: string): Promise<EscrowRecord | null> {
    const { count } = await this.prisma.escrow.updateMany({
      where: { id, autoReleaseSubmittedAt: null },
      data: { autoReleaseSubmittedAt: new Date() },
    });
    if (count === 0) {
      return null;
    }
    const result = await this.findById(id);
    await this.invalidate(id);
    return result;
  }

  /**
   * Clears the auto-release lock by nulling autoReleaseSubmittedAt,
   * allowing a retry on the next poll cycle.
   */
  async clearAutoReleaseSubmitting(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { autoReleaseSubmittedAt: null },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Finalises an auto-release by transitioning to RELEASED and recording
   * the on-chain transaction hash, then invalidates the cache.
   */
  async markAutoReleased(id: string, txHash: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'RELEASED', autoReleaseTxHash: txHash },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Atomically claims an escrow for delivery recording by setting
   * deliveryRecordedAt. Returns null if the escrow is not in SHIPPED
   * state or has already been claimed, preventing concurrent delivery
   * recordings across worker instances.
   */
  async claimDelivery(id: string): Promise<EscrowRecord | null> {
    const escrow = await this.prisma.escrow.findUnique({ where: { id } });
    if (
      !escrow ||
      escrow.state !== 'SHIPPED' ||
      escrow.deliveryRecordedAt !== null
    ) {
      return null;
    }
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { deliveryRecordedAt: new Date() },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Clears the delivery-recording claim by nulling deliveryRecordedAt,
   * allowing a retry on the next poll cycle when the contract call fails.
   */
  async clearDeliveryClaim(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { deliveryRecordedAt: null },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }

  /**
   * Returns the chronological event history for the given escrow from the
   * EscrowEvent audit table. Returns an empty array if no events exist.
   *
   * @returns an {@link EventsResult} ordered oldest-first.
   */
  async findEvents(escrowId: string): Promise<EventsResult> {
    const rawEvents = await this.prisma.escrowEvent.findMany({
      where: { escrowId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rawEvents.map((e) => ({
      event: e.toState,
      occurredAt: e.createdAt,
      fromState: e.fromState,
      toState: e.toState,
    }));
  }

  // ── Issue #28 ─────────────────────────────────────────────────────────────

  /**
   * Persists encrypted buyer contact info on the escrow record.
   * Both values arrive pre-encrypted from EscrowService — the repository
   * treats them as opaque strings and never decrypts them.
   * Invalidates the cache so the next read reflects the update.
   */
  async saveBuyerContact(
    id: string,
    encryptedEmail: string | null,
    encryptedPhone: string | null,
  ): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: {
        buyerContactEmail: encryptedEmail,
        buyerContactPhone: encryptedPhone,
      },
    });
    await this.invalidate(id);
    return toEscrowRecord(result);
  }
}
