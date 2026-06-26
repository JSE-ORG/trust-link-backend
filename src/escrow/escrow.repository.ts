import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import {
  EscrowRecord,
  EscrowState,
  PrismaService,
} from '../prisma/prisma.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';

const ESCROW_CACHE_TTL = 60; // seconds

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

  /** Persists a new escrow record with the given DTO fields and vendor address. */
  create(dto: CreateEscrowDto, vendorAddress: string): Promise<EscrowRecord> {
    return this.prisma.escrow.create({
      data: {
        id: randomUUID(),
        ...dto,
        vendorAddress,
      },
    });
  }

  /**
   * Finds the first escrow matching both vendorAddress and itemRef,
   * used to detect duplicate submissions for the same item reference.
   */
  findByVendorAndItem(
    vendorAddress: string,
    itemRef: string,
  ): Promise<EscrowRecord | null> {
    return this.prisma.escrow.findFirst({
      where: { vendorAddress, itemRef },
    });
  }

  /**
   * Returns a cached escrow by ID (60-second Redis TTL) or falls through
   * to the database on a cache miss.
   */
  async findById(id: string): Promise<EscrowRecord | null> {
    const cached = await this.cache?.get<EscrowRecord>(this.cacheKey(id));
    if (cached) return cached;
    const record = await this.prisma.escrow.findUnique({ where: { id } });
    if (record)
      await this.cache?.set(this.cacheKey(id), record, ESCROW_CACHE_TTL);
    return record;
  }

  /** Returns all escrows belonging to the given vendor address. */
  findByVendor(vendorAddress: string): Promise<EscrowRecord[]> {
    return this.prisma.escrow.findMany({ where: { vendorAddress } });
  }

  /** Returns all escrows belonging to the given buyer address. */
  findByBuyer(buyerAddress: string): Promise<EscrowRecord[]> {
    return this.prisma.escrow.findMany({ where: { buyerAddress } });
  }

  /** Updates the escrow state and invalidates its cache entry. */
  async updateState(id: string, state: EscrowState): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state },
    });
    await this.invalidate(id);
    return result;
  }

  /** Attaches a tracking ID to the escrow and invalidates its cache entry. */
  async updateTracking(id: string, trackingId: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { trackingId },
    });
    await this.invalidate(id);
    return result;
  }

  /**
   * Returns a paginated, sorted slice of escrows for the given vendor.
   * Sorts by date or amount; returns the total count before slicing.
   */
  async findVendorEscrows(
    vendorAddress: string,
    state: string | undefined,
    sort: 'date' | 'amount',
    order: 'asc' | 'desc',
    page: number,
    limit: number,
  ): Promise<{ data: EscrowRecord[]; total: number }> {
    const where = { vendorAddress, state: state as any };
    const orderBy = sort === 'amount' ? { amount: order } : { createdAt: order };
    const skip = (page - 1) * limit;

    const [data, all] = await Promise.all([
      this.prisma.escrow.findMany({ where, orderBy, skip, take: limit }) as Promise<EscrowRecord[]>,
      this.prisma.escrow.findMany({ where }) as Promise<EscrowRecord[]>,
    ]);

    return { data, total: all.length };
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
    return result;
  }

  /** Transitions the escrow to COMPLETED and invalidates the cache. */
  async markCompleted(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'COMPLETED' },
    });
    await this.invalidate(id);
    return result;
  }

  /** Transitions the escrow to REFUNDED and invalidates the cache. */
  async markRefunded(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'REFUNDED' },
    });
    await this.invalidate(id);
    return result;
  }

  /** Transitions the escrow to RELEASED and invalidates the cache. */
  async markReleased(id: string): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { state: 'RELEASED' },
    });
    await this.invalidate(id);
    return result;
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
    return result;
  }

  /**
   * Transitions the escrow to COMPLETED and records the auto-release
   * transaction hash and submission timestamp, then invalidates the cache.
   */
  async markAutoReleaseCompleted(
    id: string,
    txHash: string,
    submittedAt = new Date(),
  ): Promise<EscrowRecord> {
    const result = await this.prisma.escrow.update({
      where: { id },
      data: {
        state: 'COMPLETED',
        autoReleaseSubmittedAt: submittedAt,
        autoReleaseTxHash: txHash,
      },
    });
    await this.invalidate(id);
    return result;
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
    return result;
  }

  /**
   * Returns all SHIPPED escrows that have a non-null trackingId,
   * used by the tracking poll worker to check for delivery updates.
   */
  findShippedWithTracking(): Promise<EscrowRecord[]> {
    return this.prisma.escrow
      .findMany({ where: { state: 'SHIPPED' } })
      .then((escrows) =>
        escrows.filter((escrow) => Boolean(escrow.trackingId)),
      );
  }

  /**
   * Returns SHIPPED escrows whose deliveredAt is older than 48 hours and
   * have no open dispute or existing auto-release transaction.
   */
  findAutoReleaseEligible(referenceTime = new Date()): Promise<EscrowRecord[]> {
    const threshold = new Date(referenceTime.getTime() - 48 * 60 * 60 * 1000);

    return this.prisma.escrow.findMany({
      where: {
        state: 'SHIPPED',
        deliveredAt: { lte: threshold },
        disputeId: null,
        autoReleaseTxHash: null,
        autoReleaseSubmittedAt: null,
      },
    });
  }

  /**
   * Atomically claims an escrow for auto-release by setting autoReleaseSubmittedAt.
   */
  async markAutoReleaseSubmitting(id: string): Promise<EscrowRecord | null> {
    const escrow = await this.findById(id);
    if (!escrow || escrow.autoReleaseSubmittedAt !== null) {
      return null;
    }
    const result = await this.prisma.escrow.update({
      where: { id },
      data: { autoReleaseSubmittedAt: new Date() },
    });
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
    return result;
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
    return result;
  }

  /**
   * Derives a chronological event history for the given escrow from its
   * persisted timestamp fields. Returns an empty array if not found.
   */
  async findEvents(
    escrowId: string,
  ): Promise<Array<{ event: string; occurredAt: Date }>> {
    const escrow = await this.findById(escrowId);
    if (!escrow) return [];

    const events: Array<{ event: string; occurredAt: Date }> = [
      { event: 'CREATED', occurredAt: escrow.createdAt },
    ];
    if (escrow.shippedAt)
      events.push({ event: 'SHIPPED', occurredAt: escrow.shippedAt });
    if (escrow.deliveredAt)
      events.push({ event: 'DELIVERED', occurredAt: escrow.deliveredAt });
    if (escrow.cancelledAt)
      events.push({ event: 'CANCELLED', occurredAt: escrow.cancelledAt });

    return events.sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
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
    return result;
  }
}
