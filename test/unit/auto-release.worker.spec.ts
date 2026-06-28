import { Test } from '@nestjs/testing';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { ContractService } from '../../src/stellar/contract.service';

describe('AutoReleaseWorker (issue #10)', () => {
  let worker: AutoReleaseWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    escrowRepository = {
      findAutoReleaseEligible: jest.fn(),
      markAutoReleaseCompleted: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;
    disputeRepository = {
      findByEscrow: jest.fn(),
    } as unknown as jest.Mocked<DisputeRepository>;
    contractService = {
      submitAutoRelease: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReleaseWorker,
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: DisputeRepository, useValue: disputeRepository },
        { provide: ContractService, useValue: contractService },
      ],
    }).compile();

    worker = moduleRef.get(AutoReleaseWorker);
  });

  it('submits auto release once per eligible escrow and marks completion', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      {
        id: 'escrow-1',
        itemName: 'Camera',
        amount: 250,
        currency: 'USDC',
        itemRef: 'ref-1',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK-1',
        deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    disputeRepository.findByEscrow.mockResolvedValue(null);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');

    await worker.run(new Date('2026-05-26T00:00:00.000Z'));

    expect(contractService.submitAutoRelease).toHaveBeenCalledWith('escrow-1');
    expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledWith(
      'escrow-1',
      'tx-hash',
    );
  });

  it('skips escrows that already have a dispute', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      {
        id: 'escrow-1',
        itemName: 'Camera',
        amount: 250,
        currency: 'USDC',
        itemRef: 'ref-1',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK-1',
        deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
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
});
