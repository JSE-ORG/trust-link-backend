import { Test } from '@nestjs/testing';
import { ConfigService } from '../../src/config/config.service';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { ContractService } from '../../src/stellar/contract.service';
import { EscrowRecord } from '../../src/prisma/prisma.service';

const TEST_SOURCE_ADDRESS =
  'GCD4VP3FQK4SY3ETKW3XWJJLADV2ZNW4BWHM4DRPLVXY3UC2GBSR5TVE';

function makeConfigServiceMock(): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'AUTO_RELEASE_SOURCE_ADDRESS') {
        return TEST_SOURCE_ADDRESS;
      }
      return undefined as any;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeDeliveredEscrow(id: string, deliveredAt?: Date): EscrowRecord {
  return {
    id,
    itemName: `Item ${id}`,
    itemRef: `ref-${id}`,
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-address',
    vendorAddress: 'vendor-address',
    state: 'DELIVERED',
    trackingId: 'TRK-001',
    shippedAt: new Date('2026-01-01T00:00:00.000Z'),
    deliveredAt: deliveredAt ?? new Date('2026-01-01T00:00:00.000Z'),
    deliveryRecordedAt: deliveredAt ?? new Date('2026-01-01T00:00:00.000Z'),
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('AutoReleaseWorker (issue #10)', () => {
  let worker: AutoReleaseWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let contractService: jest.Mocked<ContractService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    escrowRepository = {
      findAutoReleaseEligible: jest.fn(),
      markAutoReleased: jest.fn(),
      markAutoReleaseSubmitting: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id } as EscrowRecord),
        ),
      clearAutoReleaseSubmitting: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id } as EscrowRecord),
        ),
    } as unknown as jest.Mocked<EscrowRepository>;
    disputeRepository = {
      findByEscrow: jest.fn(),
    } as unknown as jest.Mocked<DisputeRepository>;
    contractService = {
      submitAutoRelease: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;
    configService = makeConfigServiceMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReleaseWorker,
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: DisputeRepository, useValue: disputeRepository },
        { provide: ContractService, useValue: contractService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    worker = moduleRef.get(AutoReleaseWorker);
  });

  it('submits auto release once per eligible escrow and marks released', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      makeDeliveredEscrow('escrow-1'),
    ]);
    disputeRepository.findByEscrow.mockResolvedValue(null);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');

    await worker.run(new Date('2026-05-26T00:00:00.000Z'));

    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
      'escrow-1',
      TEST_SOURCE_ADDRESS,
    );
    expect(escrowRepository.markAutoReleased).toHaveBeenCalledWith(
      'escrow-1',
      'tx-hash',
    );
  });

  it('skips escrows that already have a dispute', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      makeDeliveredEscrow('escrow-1'),
    ]);
    disputeRepository.findByEscrow.mockResolvedValue({
      id: 'dispute-1',
      escrowId: 'escrow-1',
      reason: 'Open dispute',
      description: '',
      evidenceUrls: [],
      status: 'OPEN',
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  it('catches top-level worker failures so interval handlers do not reject', async () => {
    escrowRepository.findAutoReleaseEligible.mockRejectedValue(
      new Error('database unavailable'),
    );
    const loggerSpy = jest
      .spyOn((worker as any).logger, 'error')
      .mockImplementation();

    await expect(worker.run()).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('auto_release.worker_failed'),
      expect.any(String),
    );
  });

  // ── behaviors ported from auto-release.service.spec (review point 2) ───

  it('makes no contract calls when there are 0 eligible escrows', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([]);

    await worker.run();

    expect(escrowRepository.markAutoReleaseSubmitting).not.toHaveBeenCalled();
    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  it('skips an escrow when the optimistic lock is already held by another worker', async () => {
    const escrow = makeDeliveredEscrow('escrow-1');
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    escrowRepository.markAutoReleaseSubmitting.mockResolvedValue(null);

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
    expect(escrowRepository.markAutoReleased).not.toHaveBeenCalled();
  });

  it('logs error, clears the lock, and continues on contract failure', async () => {
    const escrow1 = makeDeliveredEscrow('escrow-1');
    const escrow2 = makeDeliveredEscrow('escrow-2');

    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      escrow1,
      escrow2,
    ]);
    escrowRepository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow1, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce({
        ...escrow2,
        autoReleaseSubmittedAt: new Date(),
      });
    contractService.submitAutoRelease
      .mockRejectedValueOnce(new Error('contract error'))
      .mockResolvedValueOnce('tx-hash-2');
    escrowRepository.clearAutoReleaseSubmitting.mockResolvedValue({
      ...escrow1,
      autoReleaseSubmittedAt: null,
    });
    escrowRepository.markAutoReleased.mockResolvedValue({
      ...escrow2,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash-2',
    });
    const loggerSpy = jest
      .spyOn((worker as any).logger, 'error')
      .mockImplementation();

    await worker.run();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('escrow-1'),
      expect.any(String),
    );
    expect(escrowRepository.clearAutoReleaseSubmitting).toHaveBeenCalledWith(
      'escrow-1',
    );
    expect(escrowRepository.markAutoReleased).toHaveBeenCalledWith(
      'escrow-2',
      'tx-hash-2',
    );
    expect(escrowRepository.markAutoReleased).not.toHaveBeenCalledWith(
      'escrow-1',
      expect.anything(),
    );
  });

  it('DB-level lock prevents duplicate submission across two sequential runs', async () => {
    const escrow = makeDeliveredEscrow('escrow-1');
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    escrowRepository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce(null);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    escrowRepository.markAutoReleased.mockResolvedValue({
      ...escrow,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash',
    });

    await worker.run();
    await worker.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
    expect(escrowRepository.markAutoReleased).toHaveBeenCalledTimes(1);
  });

  it('clears the lock on failure so the next run can retry', async () => {
    const escrow = makeDeliveredEscrow('escrow-1');
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    escrowRepository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() });
    contractService.submitAutoRelease
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce('tx-hash');
    escrowRepository.clearAutoReleaseSubmitting.mockResolvedValue({
      ...escrow,
      autoReleaseSubmittedAt: null,
    });
    escrowRepository.markAutoReleased.mockResolvedValue({
      ...escrow,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash',
    });

    await worker.run();
    await worker.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
    expect(escrowRepository.clearAutoReleaseSubmitting).toHaveBeenCalledTimes(
      1,
    );
    expect(escrowRepository.markAutoReleased).toHaveBeenCalledTimes(1);
  });

  it('concurrent worker runs: only one submission when two workers race', async () => {
    const escrow = makeDeliveredEscrow('escrow-1');
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
    escrowRepository.markAutoReleaseSubmitting
      .mockResolvedValueOnce({ ...escrow, autoReleaseSubmittedAt: new Date() })
      .mockResolvedValueOnce(null);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');
    escrowRepository.markAutoReleased.mockResolvedValue({
      ...escrow,
      state: 'RELEASED',
      autoReleaseTxHash: 'tx-hash',
    });

    await Promise.all([worker.run(), worker.run()]);

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
    expect(escrowRepository.markAutoReleased).toHaveBeenCalledTimes(1);
  });
});
