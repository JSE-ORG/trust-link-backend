/* eslint-disable @typescript-eslint/unbound-method */
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
  amount: 100,
  currency: 'USDC',
  buyerAddress: 'buyer-address',
  vendorAddress: 'vendor-address',
  state: 'SHIPPED',
  trackingId: 'TRK-001',
  shippedAt: new Date('2026-01-01T00:00:00.000Z'), // older than the 7-day cutoff
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

// ── tests ─────────────────────────────────────────────────────────────────

describe('AutoReleaseService.run (issue #24)', () => {
  let service: AutoReleaseService;
  let repository: jest.Mocked<EscrowRepository>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    repository = {
      findAutoReleaseEligible: jest.fn(),
      markReleased: jest.fn(),
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls submitAutoRelease and markReleased for each eligible escrow', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    repository.markReleased.mockResolvedValue({ ...escrow, state: 'RELEASED' });

    await service.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledWith('escrow-1');
    expect(repository.markReleased).toHaveBeenCalledWith('escrow-1');
  });

  it('makes no contract calls when there are 0 eligible escrows', async () => {
    repository.findAutoReleaseEligible.mockResolvedValue([]);

    await service.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    expect(repository.markReleased).not.toHaveBeenCalled();
  });

  it('logs error and continues processing remaining escrows on contract failure', async () => {
    const escrow1 = makeShippedEscrow('escrow-1');
    const escrow2 = makeShippedEscrow('escrow-2');
    repository.findAutoReleaseEligible.mockResolvedValue([escrow1, escrow2]);
    contractService.submitAutoRelease
      .mockRejectedValueOnce(new Error('contract error for escrow-1'))
      .mockResolvedValueOnce('tx-hash-2');
    repository.markReleased.mockResolvedValue({
      ...escrow2,
      state: 'RELEASED',
    });

    await service.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('escrow-1'),
      expect.any(Error),
    );
    // escrow-2 was still processed despite escrow-1 failing
    expect(repository.markReleased).toHaveBeenCalledWith('escrow-2');
    expect(repository.markReleased).not.toHaveBeenCalledWith('escrow-1');
  });

  it('idempotency check prevents the same escrow from being submitted twice', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    // Mock always returns the same escrow — in production, state change to
    // RELEASED would filter it out, but here we verify the in-process guard.
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    repository.markReleased.mockResolvedValue({ ...escrow, state: 'RELEASED' });

    await service.run(); // first run: processes escrow-1 → added to processingIds
    await service.run(); // second run: escrow-1 is in processingIds → skipped

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
  });

  it('removes failed escrows from processingIds so they can be retried', async () => {
    const escrow = makeShippedEscrow('escrow-1');
    repository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    contractService.submitAutoRelease
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce('tx-hash');
    repository.markReleased.mockResolvedValue({ ...escrow, state: 'RELEASED' });

    await service.run(); // first run: fails → removed from processingIds
    await service.run(); // second run: retried → succeeds

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
    expect(repository.markReleased).toHaveBeenCalledTimes(1);
  });
});
