import { CacheService } from '../../src/cache/cache.service';
import { ConfigService } from '../../src/config/config.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { EscrowRecord, PrismaService } from '../../src/prisma/prisma.service';
import { ensureVendors } from '../prisma-helpers';

const VENDOR = 'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER = 'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';

/** Records every set so the TTL and hit/miss behaviour can be asserted. */
class RecordingCache {
  readonly store = new Map<string, unknown>();
  readonly set = jest.fn((key: string, value: unknown, _ttl?: number) => {
    this.store.set(key, value);
    return Promise.resolve();
  });
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.store.get(key) as T) ?? null);
  }
  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}

function configWithTtl(ttl: number | undefined): ConfigService {
  return {
    get: (key: string) =>
      key === 'ESCROW_CACHE_TTL_SECONDS' ? ttl : undefined,
  } as unknown as ConfigService;
}

describe('GET /escrow/:id read cache (R-CA-01, R-CA-03, R-CA-04)', () => {
  let prisma: PrismaService;
  let cache: RecordingCache;
  let repo: EscrowRepository;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    await ensureVendors(prisma, VENDOR);
    cache = new RecordingCache();
    repo = new EscrowRepository(
      prisma,
      cache as unknown as CacheService,
      configWithTtl(30),
    );
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  async function newEscrow(state: EscrowRecord['state'] = 'FUNDED') {
    const escrow = await repo.create(
      {
        itemName: 'Lamp',
        itemRef: `ref-${Math.random()}`,
        amount: 10,
        currency: 'USDC',
        buyerAddress: BUYER,
      },
      VENDOR,
    );
    await prisma.escrow.update({ where: { id: escrow.id }, data: { state } });
    return escrow.id;
  }

  it('misses, reads the database, and caches with the configured TTL', async () => {
    const id = await newEscrow();
    const spy = jest.spyOn(prisma.escrow, 'findUnique');

    const first = await repo.findById(id);

    expect(first?.id).toBe(id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      `escrow:${id}`,
      expect.objectContaining({ id }),
      30,
    );
  });

  it('serves a hit from the cache without touching the database', async () => {
    const id = await newEscrow();
    await repo.findById(id);
    const spy = jest.spyOn(prisma.escrow, 'findUnique');

    const second = await repo.findById(id);

    expect(second?.id).toBe(id);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 60],
    [10, 10],
    [600, 60],
  ])('uses TTL %p as %i seconds', async (configured, expected) => {
    repo = new EscrowRepository(
      prisma,
      cache as unknown as CacheService,
      configWithTtl(configured),
    );
    const id = await newEscrow();
    await repo.findById(id);
    expect(cache.set).toHaveBeenLastCalledWith(
      `escrow:${id}`,
      expect.anything(),
      expected,
    );
  });

  type Write = [
    string,
    EscrowRecord['state'],
    (id: string) => Promise<unknown>,
    (e: EscrowRecord) => unknown,
    unknown,
  ];
  const writes: Write[] = [
    [
      'updateState',
      'FUNDED',
      (id) => repo.updateState(id, 'SHIPPED'),
      (e) => e.state,
      'SHIPPED',
    ],
    [
      'updateTracking',
      'FUNDED',
      (id) => repo.updateTracking(id, 'TRK-1'),
      (e) => e.trackingId,
      'TRK-1',
    ],
    [
      'markShipped',
      'FUNDED',
      (id) => repo.markShipped(id, 'TRK-2'),
      (e) => e.state,
      'SHIPPED',
    ],
    [
      'markTrackingChecked',
      'SHIPPED',
      (id) => repo.markTrackingChecked(id, new Date('2026-01-01T00:00:00Z')),
      (e) => e.trackingCheckedAt?.toISOString(),
      '2026-01-01T00:00:00.000Z',
    ],
    [
      'markDelivered',
      'SHIPPED',
      (id) => repo.markDelivered(id),
      (e) => e.state,
      'DELIVERED',
    ],
    [
      'claimDelivery',
      'SHIPPED',
      (id) => repo.claimDelivery(id),
      (e) => e.deliveryRecordedAt !== null,
      true,
    ],
    [
      'clearDeliveryClaim',
      'SHIPPED',
      async (id) => {
        await repo.claimDelivery(id);
        await repo.findById(id);
        return repo.clearDeliveryClaim(id);
      },
      (e) => e.deliveryRecordedAt,
      null,
    ],
    [
      'markAutoReleaseSubmitting',
      'DELIVERED',
      (id) => repo.markAutoReleaseSubmitting(id),
      (e) => e.autoReleaseSubmittedAt !== null,
      true,
    ],
    [
      'clearAutoReleaseSubmitting',
      'DELIVERED',
      async (id) => {
        await repo.markAutoReleaseSubmitting(id);
        await repo.findById(id);
        return repo.clearAutoReleaseSubmitting(id);
      },
      (e) => e.autoReleaseSubmittedAt,
      null,
    ],
    [
      'recordAutoReleaseSubmission',
      'DELIVERED',
      (id) => repo.recordAutoReleaseSubmission(id, 'hash-1'),
      (e) => e.autoReleaseTxHash,
      'hash-1',
    ],
    [
      'markAutoReleased',
      'DELIVERED',
      (id) => repo.markAutoReleased(id, 'hash-2'),
      (e) => e.state,
      'RELEASED',
    ],
    [
      'markCompleted',
      'DELIVERED',
      (id) => repo.markCompleted(id),
      (e) => e.state,
      'COMPLETED',
    ],
    [
      'markRefunded',
      'FUNDED',
      (id) => repo.markRefunded(id),
      (e) => e.state,
      'REFUNDED',
    ],
    [
      'markCancelled',
      'CREATED',
      (id) => repo.markCancelled(id),
      (e) => e.state,
      'CANCELLED',
    ],
    [
      'saveBuyerContact',
      'FUNDED',
      (id) => repo.saveBuyerContact(id, 'enc-email', null),
      (e) => e.buyerContactEmail,
      'enc-email',
    ],
  ];

  it.each(writes)(
    'a read after %s returns fresh data',
    async (_name, start, write, pick, expected) => {
      const id = await newEscrow(start);
      await repo.findById(id);
      expect(cache.store.has(`escrow:${id}`)).toBe(true);

      await write(id);
      const fresh = await repo.findById(id);

      expect(pick(fresh as EscrowRecord)).toEqual(expected);
    },
  );
});
