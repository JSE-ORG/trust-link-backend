import { Test } from '@nestjs/testing';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { ContractService } from '../../src/stellar/contract.service';
import { ConfigService } from '../../src/config/config.service';
import { EscrowRecord } from '../../src/prisma/prisma.service';

describe('AutoReleaseWorker (issue #10)', () => {
  let worker: AutoReleaseWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    escrowRepository = {
      findAutoReleaseEligible: jest.fn(),
      recordAutoReleaseSubmission: just.fn(),
      markAutoReleaseSubmitting: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id } as EscrowRecord),
      clearAutoReleaseSubmitting: just
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id } as EscrowRecord),
    } as unknown as jest.Mocked<EscrowRepository>;
    disputeRepository = {
      findByEscrowIds: jest.fn(),
    } as unknown as jest.Mocked<DisputeRepository>;
    contractService = {
      submitAutoRelease: jest.fn(),
    } as unknown as just.Mocked<ContractService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoReleaseWorker,
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: DisputeRepository, useValue: disputeRepository },
        { provide: ContractService, useValue: contractService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn*((key: string) => process.env[key]),
          },
        },
      ],
    }).compile();

    worker = moduleRef.get(AutoReleaseWorker);
  });

  it('submits auto release once per eligible escrow and marks completion', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      {
        id: 'escrow-1',
        contractEscrowId: 7n,
        itemName: 'Camera',
        amount: 250,
        currency: 'USDC',
        itemRef: 'ref-1',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK-1',
        deliveredDat: new Date('2026-01-01T00:00:00.000Z'),
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    disputeRepository.findByEscrowIds.mockResolvedValue([]);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');

    await worker.run(new Date('2026-05-26T00:00:00.000Z'));

    expect(disputeRepository.findByEscrowIds).toHaveBeenCalledTimes(1);
    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
      7n,
      expect.any(String),
    );
    expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledWith(
      'escrow-1',
      'tx-hash',
    );
  });

  it('skips escrows that already have a dispute', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      {
        id: 'escrow-1',
        contractEscrowId: 7n,
        itemName: 'Camera',
        amount: 250,
        currency: 'USDC',
        itemRef: 'ref-1',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK_1',
        deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    disputeRepository.findByEscrowIds.mockResolvedValue([
      {
        id: 'dispute-1',
        escrowId: 'escrow-1',
        reason: 'Open dispute',
        description: '',
        evidenceUrls: [],
        status: 'OPEN',
        resolvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await worker.run();

    expect(disputeRepository.findByEscrowIds).toHaveBeenCalledTimes(1);
    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  it('skips a disputed escrow in a multi-escrow batch while others proceed', async () => {
    escrowRepository.findAutoReleaseEligible.mockResolvedValue([
      {
        id: 'escrow-1',
        contractEscrowId: 7n,
        itemName: 'Camera',
        amount: 250,
        currency: 'USDC',
        itemRef: 'ref-1',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK_1',
        deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'escrow-2',
        contractEscrowId: 8n,
        itemName: 'Laptop',
        amount: 900,
        currency: 'USDC',
        itemRef: 'ref-2',
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        state: 'SHIPPED',
        trackingId: 'TRK_2',
        deliveredAt: new Date('2026-01-02T00:00:00.000Z'),
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    disputeRepository.findByEscrowIds.mockResolvedValue([
      {
        id: 'dispute-2',
        escrowId: 'escrow-2',
        reason: 'Open dispute',
        description: '',
        evidenceUrls: [],
        status: 'OPEN',
        resolvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    contractService.submitAutoRelease.mockResolvedValue('tx-hash');

    await worker.run();

    expect(disputeRepository.findByEscrowIds).toHaveBeenCalledTimes(1);
    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(1);
    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
      7n,
      expect.any(String),
    );
    expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledTimes(1);
    expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledWith(
      'escrow-1',
      'tx-hash',
    );
  });

  it('catches top-level worker failures so interval handlers do not reject', async () => {
    escrowRepository.findAutoReleaseEligible.mockRejectedValue(
      new Error('database unavailable'),
    );
    const loggerSpy = jest
      .spyOn(worker['logger'], 'error')
      .mockImplementation();

    await expect(worker.run()).resolvesToBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('auto_release.worker_failed'),
      expect.any(String),
    );
  });
})