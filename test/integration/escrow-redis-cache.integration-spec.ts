import { CacheService } from '../../src/cache/cache.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ensureVendors } from '../prisma-helpers';

const VENDOR = 'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER = 'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';

/** Past Number.MAX_SAFE_INTEGER, so a lossy number round trip would show. */
const CONTRACT_ESCROW_ID = 9_007_199_254_740_993n;

/**
 * Stands in for the ioredis client. Like Redis, it only stores strings, so
 * every value goes through the same JSON.stringify / JSON.parse path that
 * CacheService uses against a real server.
 */
class StringOnlyRedis {
  readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    if (typeof value !== 'string') {
      throw new TypeError('Redis only stores strings');
    }
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }

  quit(): Promise<'OK'> {
    return Promise.resolve('OK');
  }
}

/**
 * Builds a CacheService that takes its Redis code path instead of the
 * in-memory fallback, which keeps the original objects and so hides any type
 * a JSON round trip would lose.
 */
function redisBackedCache(redis: StringOnlyRedis): CacheService {
  const cache = new CacheService();
  (cache as unknown as { client: StringOnlyRedis }).client = redis;
  return cache;
}

describe('EscrowRepository.findById with a Redis-backed cache (issue #1003)', () => {
  let prisma: PrismaService;
  let redis: StringOnlyRedis;
  let cache: CacheService;
  let repo: EscrowRepository;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    await ensureVendors(prisma, VENDOR);
    redis = new StringOnlyRedis();
    cache = redisBackedCache(redis);
    repo = new EscrowRepository(prisma, cache);
  });

  afterEach(async () => {
    await cache?.onModuleDestroy();
    await prisma?.$disconnect();
  });

  async function createEscrowWithEveryTypedField(): Promise<string> {
    const escrow = await repo.create(
      {
        itemName: 'Vintage jacket',
        itemRef: 'jacket-001',
        amount: 75.5,
        currency: 'USDC',
        buyerAddress: BUYER,
      },
      VENDOR,
    );
    const now = Date.now();
    await prisma.escrow.update({
      where: { id: escrow.id },
      data: {
        contractEscrowId: CONTRACT_ESCROW_ID,
        shippedAt: new Date(now - 3_000),
        deliveredAt: new Date(now - 2_000),
        deliveryRecordedAt: new Date(now - 1_000),
        autoReleaseSubmittedAt: new Date(now),
      },
    });
    return escrow.id;
  }

  it('stores the escrow in Redis as a JSON string on a cache miss', async () => {
    const id = await createEscrowWithEveryTypedField();

    await repo.findById(id);

    const raw = redis.store.get(`escrow:${id}`);
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    // The round trip really does strip the types: these are what a cache hit
    // gets back from Redis before the repository revives them.
    expect(typeof parsed.createdAt).toBe('string');
    expect(parsed.contractEscrowId).toBe(CONTRACT_ESCROW_ID.toString());
  });

  it('returns the same field types on a cache hit as on a miss', async () => {
    const id = await createEscrowWithEveryTypedField();

    const miss = await repo.findById(id);
    const hit = await repo.findById(id);

    expect(redis.store.has(`escrow:${id}`)).toBe(true);
    expect(hit).toEqual(miss);
  });

  it('revives Date fields from a cache hit as Date objects', async () => {
    const id = await createEscrowWithEveryTypedField();

    await repo.findById(id);
    const hit = await repo.findById(id);

    expect(hit!.createdAt).toBeInstanceOf(Date);
    expect(hit!.updatedAt).toBeInstanceOf(Date);
    expect(hit!.shippedAt).toBeInstanceOf(Date);
    expect(hit!.deliveredAt).toBeInstanceOf(Date);
    expect(hit!.deliveryRecordedAt).toBeInstanceOf(Date);
    expect(hit!.autoReleaseSubmittedAt).toBeInstanceOf(Date);
    expect(hit!.deliveredAt!.getTime()).toBeLessThan(
      hit!.deliveryRecordedAt!.getTime(),
    );
  });

  it('keeps unset Date fields null on a cache hit', async () => {
    const id = await createEscrowWithEveryTypedField();

    await repo.findById(id);
    const hit = await repo.findById(id);

    expect(hit!.cancelledAt).toBeNull();
  });

  it('revives contractEscrowId from a cache hit as a bigint without losing precision', async () => {
    const id = await createEscrowWithEveryTypedField();

    await repo.findById(id);
    const hit = await repo.findById(id);

    expect(typeof hit!.contractEscrowId).toBe('bigint');
    expect(hit!.contractEscrowId).toBe(CONTRACT_ESCROW_ID);
  });

  it('keeps a null contractEscrowId null on a cache hit', async () => {
    const escrow = await repo.create(
      {
        itemName: 'Unmatched',
        itemRef: 'unmatched-001',
        amount: 10,
        currency: 'USDC',
        buyerAddress: BUYER,
      },
      VENDOR,
    );

    await repo.findById(escrow.id);
    const hit = await repo.findById(escrow.id);

    expect(hit!.contractEscrowId).toBeNull();
  });

  it('returns amount as a number on a cache hit', async () => {
    const id = await createEscrowWithEveryTypedField();

    await repo.findById(id);
    const hit = await repo.findById(id);

    expect(hit!.amount).toBe(75.5);
  });
});
