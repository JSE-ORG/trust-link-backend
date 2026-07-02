import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AutoReleaseService } from '../../src/escrow/auto-release.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { EscrowRecord } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';

// ── shared fixtures ───────────────────────────────────────────────────────

const makeShippedEscrow = (id: string): EscrowRecord => ({
  id,
  itemName: `Item ${id}`,
  itemRef: `ref-${id}`,
  amount: 100,
  currency: 'USDC',
  buyerAddress: 'buyer-address',
  vendorAddress: 'vendor-address',
  state: 'SHIPPED',
  trackingId: 'TRK-001',
  shippedAt: new Date('2026-01-01T00:00:00.000Z'),
  deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
  deliveryRecordedAt: new Date('2026-01-01T00:00:00.000Z'),
  autoReleaseSubmittedAt: null,
  autoReleaseTxHash: null,
  disputeId: null,
  cancelledAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

// ── tests ─────────────────────────────────────────────────────────────────

describe('AutoReleaseService.run', () => {
  let service: AutoReleaseService;
  let repository: jest.Mocked<EscrowRepository>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    repository = {
      findAutoReleaseEligible: jest.fn(),
      markAutoReleaseSubmitting: jest.fn(),
      clearAutoReleaseSubmitting: jest.fn(),
      markAutoReleased: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    contractService = {
      submitAutoRelease: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReleaseService,
        { provide: EscrowRepository, useValue: repository },
        { provide: ContractService, useValue: contractService },
      ],
    }).compile();

    service = moduleRef.get(AutoReleaseService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes a cutoff exactly 7 days before now to findAutoReleaseEligible', async () => {
    const fakeNow = new Date('2026-06-27T12:00:00.000Z');
    jest.useFakeTimers({ now: fakeNow });

    repository.findAutoReleaseEligible.mockResolvedValue([]);

    await service.run();

    const expectedCutoff = new Date(
      fakeNow.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    expect(repository.findAutoReleaseEligible).toHaveBeenCalledWith(
      expectedCutoff,
    );

    jest.useRealTimers();
  });

  it('claims, submits, and marks released for each eligible escrow', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    const claimed = { ...escrow, autoReleaseSubmittedAt: new Date() };
    const released = {
      ...escrow,
      state: 'RELEASED' as const,
      autoReleaseTxHash: 'tx-hash',
    };

    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    repository.markAutoReleaseSubmitting.mockResolvedValue(claimed);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    repository.markAutoReleased.mockResolvedValue(released);

    await service.run();

    expect(repository.markAutoReleaseSubmitting).toHaveBeenCalledWith(
      'escrow-1',
    );
    expect(contractService.submitAutoRelease).toHaveBeenCalledWith('escrow-1');
    expect(repository.markAutoReleased).toHaveBeenCalledWith(
      'escrow-1',
      'tx-hash',
    );
  });

  it('makes no contract calls when there are 0 eligible escrows', async () => {
    repository.findAutoReleaseEligible.mockResolvedValue([]);

    await service.run();

    expect(repository.markAutoReleaseSubmitting).not.toHaveBeenCalled();
    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  it('skips an escrow when the optimistic lock is already held by another worker', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    repository.markAutoReleaseSubmitting.mockResolvedValue(null); // lock not acquired

    await service.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    expect(repository.markAutoReleased).not.toHaveBeenCalled();
  });

  it('logs error, clears the lock, and continues on contract failure', async () => {
    const escrow1 = makeShippedEscrow('escrow-1');
    const escrow2 = makeShippedEscrow('escrow-2');

    repository.findAutoReleaseEligible.mockResolvedValue([escrow1, escrow2]);
    repository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow1, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce({
        ...escrow2,
        autoReleaseSubmittedAt: new Date(),
      });
    contractService.submitAutoRelease
      .mockRejectedValueOnce(new Error('contract error'))
      .mockResolvedValueOnce('tx-hash-2');
    repository.clearAutoReleaseSubmitting.mockResolvedValue({
      ...escrow1,
      autoReleaseSubmittedAt: null,
    });
    repository.markAutoReleased.mockResolvedValue({
      ...escrow2,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash-2',
    });

    await service.run();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('escrow-1'),
      expect.any(Error),
    );
    expect(repository.clearAutoReleaseSubmitting).toHaveBeenCalledWith(
      'escrow-1',
    );
    expect(repository.markAutoReleased).toHaveBeenCalledWith(
      'escrow-2',
      'tx-hash-2',
    );
    expect(repository.markAutoReleased).not.toHaveBeenCalledWith(
      'escrow-1',
      expect.anything(),
    );
  });

  it('DB-level lock prevents duplicate submission across two sequential runs', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    // Both runs return the same escrow (mock doesn't filter by state)
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    // First run acquires the lock; second run sees it already held
    repository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce(null);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    repository.markAutoReleased.mockResolvedValue({
      ...escrow,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash',
    });

    await service.run();
    await service.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
    expect(repository.markAutoReleased).toHaveBeenCalledTimes(1);
  });

  it('clears the lock on failure so the next run can retry', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    repository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() });
    contractService.submitAutoRelease
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce('tx-hash');
    repository.clearAutoReleaseSubmitting.mockResolvedValue({
      ...escrow,
      autoReleaseSubmittedAt: null,
    });
    repository.markAutoReleased.mockResolvedValue({
      ...escrow,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash',
    });

    await service.run(); // first run: fails → lock cleared
    await service.run(); // second run: retried → succeeds

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
    expect(repository.clearAutoReleaseSubmitting).toHaveBeenCalledTimes(1);
    expect(repository.markAutoReleased).toHaveBeenCalledTimes(1);
  });

  it('concurrent worker runs: only one submission when two workers race', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    // Worker A claims the lock; worker B finds it already held
    repository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce(null);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    repository.markAutoReleased.mockResolvedValue({
      ...escrow,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash',
    });

    await Promise.all([service.run(), service.run()]);

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
    expect(repository.markAutoReleased).toHaveBeenCalledTimes(1);
  });
});
