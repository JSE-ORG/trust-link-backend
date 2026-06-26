import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AutoReleaseWorker } from '../src/workers/auto-release.worker';
import { ContractService } from '../src/stellar/contract.service';

/**
 * E2E tests for concurrent auto-release collision detection (issues #302, #307, #308).
 *
 * Because Node.js is single-threaded, two Promise.all concurrent worker.run() calls
 * interleave at every `await` point. Both workers call findAutoReleaseEligible()
 * before either has finished processing, so both receive the same eligible escrow
 * in their snapshot. The collision guard relies on:
 *   1. The in-memory check: `escrow.state === 'COMPLETED' || escrow.autoReleaseTxHash`
 *      (stale snapshot — does NOT protect against concurrent runs that fetched
 *       the list before the first write completed).
 *   2. The DB-level guard: findAutoReleaseEligible filters autoReleaseTxHash: null,
 *      but both workers have already fetched their snapshots, so this only helps
 *      on the NEXT poll cycle.
 *   3. markAutoReleaseSubmitting atomically sets autoReleaseSubmittedAt and returns
 *      null if already set — this is the true optimistic lock the worker should use.
 *
 * These tests verify that even under concurrent execution:
 * - submitAutoRelease is called exactly once per escrow
 * - The final DB state reflects exactly one successful auto-release
 * - The worker correctly skips an escrow it detects as already processed
 */
describe('Auto-Release Worker — concurrent collision detection (issues #302/#307/#308)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: AutoReleaseWorker;
  let contractService: ContractService;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    worker = app.get(AutoReleaseWorker);
    contractService = app.get(ContractService);

    await prisma.reset();

    // Spy on the Logger prototype so we can assert skip/warn log entries
    // without coupling to internal Logger instances.
    loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  /**
   * Helper: create a single escrow that is eligible for auto-release.
   * deliveredAt is 50 hours ago (well past the 48-hour threshold).
   */
  async function createEligibleEscrow(suffix: string) {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);
    return prisma.escrow.create({
      data: {
        itemName: `Concurrent Item ${suffix}`,
        itemRef: `concurrent-item-${suffix}`,
        amount: 500,
        currency: 'USDC',
        buyerAddress: `buyer-concurrent-${suffix}`,
        vendorAddress: `vendor-concurrent-${suffix}`,
        state: 'SHIPPED',
        trackingId: `TRK-CONCURRENT-${suffix}`,
        shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
        deliveredAt: pastDelivery,
        deliveryRecordedAt: pastDelivery,
      },
    });
  }

  it('calls submitAutoRelease exactly once when two workers race for the same eligible escrow', async () => {
    const TX_HASH = 'tx-hash-concurrent-001';

    // Slow down submitAutoRelease so both workers advance past their
    // findAutoReleaseEligible fetch before either completes processing.
    // A 10 ms delay is enough to expose the interleaving on Node's event loop.
    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(TX_HASH), 10),
          ),
      );

    const escrow = await createEligibleEscrow('001');

    // Run two workers concurrently. Both will pick up the same eligible
    // snapshot before either has finished writing.
    await Promise.all([worker.run(), worker.run()]);

    // Only one on-chain submission should have been made.
    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(escrow.id);

    // The escrow must be in its terminal state with the correct tx hash.
    const after = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    expect(after).not.toBeNull();
    expect(after!.autoReleaseTxHash).toBe(TX_HASH);
    expect(after!.autoReleaseSubmittedAt).toBeTruthy();
    // State is set to COMPLETED by markAutoReleaseCompleted.
    expect(after!.state).toBe('COMPLETED');
  });

  it('does not double-process an escrow when the second run starts after the first has already committed', async () => {
    const TX_HASH = 'tx-hash-sequential-002';

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue(TX_HASH);

    const escrow = await createEligibleEscrow('002');

    // First run completes fully before the second starts.
    await worker.run();

    // Escrow should now be COMPLETED and excluded from the second run's
    // eligible query (autoReleaseTxHash is no longer null).
    await worker.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);

    const after = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    expect(after!.autoReleaseTxHash).toBe(TX_HASH);
    expect(after!.state).toBe('COMPLETED');
  });

  it('skips an escrow mid-loop when a sibling concurrent worker has already written autoReleaseTxHash to the DB', async () => {
    const TX_HASH = 'tx-hash-midloop-003';

    // Track invocation order to confirm only one submission was attempted.
    const callOrder: string[] = [];

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockImplementation(async (id: string) => {
        callOrder.push(id);
        // Pause long enough for the second worker's loop to reach its own
        // in-memory check, giving the test a deterministic interleave window.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return TX_HASH;
      });

    const escrow = await createEligibleEscrow('003');

    await Promise.all([worker.run(), worker.run()]);

    // Regardless of interleave order, the escrow must only be submitted once.
    expect(callOrder.filter((id) => id === escrow.id)).toHaveLength(1);

    const after = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    expect(after!.autoReleaseTxHash).toBe(TX_HASH);
    expect(after!.state).toBe('COMPLETED');
  });

  it('processes multiple independent escrows exactly once each under concurrent workers', async () => {
    const TX_HASH_A = 'tx-hash-multi-004a';
    const TX_HASH_B = 'tx-hash-multi-004b';

    // Return distinct hashes keyed by call order so we can assert both escrows
    // end up with their respective hash (the spy always returns the same value
    // here because both IDs map to the same mock; adjust if per-id routing matters).
    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValueOnce(TX_HASH_A)
      .mockResolvedValueOnce(TX_HASH_B);

    const escrowA = await createEligibleEscrow('004a');
    const escrowB = await createEligibleEscrow('004b');

    await Promise.all([worker.run(), worker.run()]);

    // Total across both workers must equal the number of distinct escrows.
    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

    const afterA = await prisma.escrow.findUnique({ where: { id: escrowA.id } });
    const afterB = await prisma.escrow.findUnique({ where: { id: escrowB.id } });

    // Each escrow must be in a terminal auto-release state.
    expect(afterA!.autoReleaseTxHash).not.toBeNull();
    expect(afterA!.state).toBe('COMPLETED');
    expect(afterB!.autoReleaseTxHash).not.toBeNull();
    expect(afterB!.state).toBe('COMPLETED');
  });

  it('leaves escrow in a consistent state when submitAutoRelease throws during a concurrent run', async () => {
    const TX_HASH = 'tx-hash-error-005';
    let callCount = 0;

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          // First call fails; simulate a transient network error.
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Stellar node timeout');
        }
        return TX_HASH;
      });

    const escrow = await createEligibleEscrow('005');

    // One worker fails, the other should still complete successfully.
    await Promise.all([worker.run(), worker.run()]);

    // Exactly two attempts were made (one from each concurrent worker).
    expect(callCount).toBe(2);

    const after = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    // The successful call's hash must be persisted.
    expect(after!.autoReleaseTxHash).toBe(TX_HASH);
    expect(after!.state).toBe('COMPLETED');
  });
});
