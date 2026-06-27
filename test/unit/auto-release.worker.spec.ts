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
      status: 'OPEN',
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  describe('Partial batch failure recovery', () => {
    it('continues processing remaining escrows when one fails', async () => {
      const escrows = [
        {
          id: 'escrow-1',
          itemName: 'Camera',
          amount: 250,
          currency: 'USDC',
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
        {
          id: 'escrow-2',
          itemName: 'Laptop',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-2',
          deliveredAt: new Date('2026-01-02T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'escrow-3',
          itemName: 'Phone',
          amount: 800,
          currency: 'USDC',
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          state: 'SHIPPED',
          trackingId: 'TRK-3',
          deliveredAt: new Date('2026-01-03T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      escrowRepository.findAutoReleaseEligible.mockResolvedValue(escrows);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      // Second escrow fails, but first and third succeed
      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce('tx-hash-3');

      await worker.run(new Date('2026-05-26T00:00:00.000Z'));

      // All three should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(3);
      expect(contractService.submitAutoRelease).toHaveBeenNthCalledWith(
        1,
        'escrow-1',
      );
      expect(contractService.submitAutoRelease).toHaveBeenNthCalledWith(
        2,
        'escrow-2',
      );
      expect(contractService.submitAutoRelease).toHaveBeenNthCalledWith(
        3,
        'escrow-3',
      );

      // Only successful ones should be marked complete
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledTimes(
        2,
      );
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledWith(
        'escrow-1',
        'tx-hash-1',
      );
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledWith(
        'escrow-3',
        'tx-hash-3',
      );
    });

    it('logs individual failure details without aborting the batch', async () => {
      const loggerErrorSpy = jest.spyOn(worker['logger'], 'error');
      const loggerLogSpy = jest.spyOn(worker['logger'], 'log');

      const escrows = [
        {
          id: 'escrow-1',
          itemName: 'Camera',
          amount: 250,
          currency: 'USDC',
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
        {
          id: 'escrow-2',
          itemName: 'Laptop',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-2',
          deliveredAt: new Date('2026-01-02T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      escrowRepository.findAutoReleaseEligible.mockResolvedValue(escrows);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      const networkError = new Error('Connection refused');
      contractService.submitAutoRelease
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('tx-hash-2');

      await worker.run(new Date('2026-05-26T00:00:00.000Z'));

      // Verify individual error was logged with details
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Auto-release failed for escrow escrow-1: Connection refused',
        expect.any(String),
      );

      // Verify summary logs
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Processing batch of 2 eligible escrow(s) for auto-release',
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Batch complete: 1 succeeded, 1 failed out of 2 total',
      );
    });

    it('tracks successful and failed counts separately', async () => {
      const loggerLogSpy = jest.spyOn(worker['logger'], 'log');
      const loggerWarnSpy = jest.spyOn(worker['logger'], 'warn');

      const escrows = [
        {
          id: 'escrow-1',
          itemName: 'Camera',
          amount: 250,
          currency: 'USDC',
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
        {
          id: 'escrow-2',
          itemName: 'Laptop',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-2',
          deliveredAt: new Date('2026-01-02T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'escrow-3',
          itemName: 'Phone',
          amount: 800,
          currency: 'USDC',
          buyerAddress: 'buyer-3',
          vendorAddress: 'vendor-3',
          state: 'SHIPPED',
          trackingId: 'TRK-3',
          deliveredAt: new Date('2026-01-03T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'escrow-4',
          itemName: 'Tablet',
          amount: 600,
          currency: 'USDC',
          buyerAddress: 'buyer-4',
          vendorAddress: 'vendor-4',
          state: 'SHIPPED',
          trackingId: 'TRK-4',
          deliveredAt: new Date('2026-01-04T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      escrowRepository.findAutoReleaseEligible.mockResolvedValue(escrows);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      // 2 succeed, 2 fail
      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Insufficient balance'))
        .mockResolvedValueOnce('tx-hash-4');

      await worker.run(new Date('2026-05-26T00:00:00.000Z'));

      // Verify summary with correct counts
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Batch complete: 2 succeeded, 2 failed out of 4 total',
      );

      // Verify failed escrows are listed
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed escrows:'),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('escrow-2 (Network error)'),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('escrow-3 (Insufficient balance)'),
      );
    });

    it('handles all escrows failing gracefully', async () => {
      const loggerLogSpy = jest.spyOn(worker['logger'], 'log');

      const escrows = [
        {
          id: 'escrow-1',
          itemName: 'Camera',
          amount: 250,
          currency: 'USDC',
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
        {
          id: 'escrow-2',
          itemName: 'Laptop',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-2',
          deliveredAt: new Date('2026-01-02T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      escrowRepository.findAutoReleaseEligible.mockResolvedValue(escrows);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      contractService.submitAutoRelease.mockRejectedValue(
        new Error('Service unavailable'),
      );

      await worker.run(new Date('2026-05-26T00:00:00.000Z'));

      // All should be attempted
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);

      // None should be marked complete
      expect(escrowRepository.markAutoReleaseCompleted).not.toHaveBeenCalled();

      // Verify correct failure count
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Batch complete: 0 succeeded, 2 failed out of 2 total',
      );
    });

    it('handles all escrows succeeding', async () => {
      const loggerLogSpy = jest.spyOn(worker['logger'], 'log');
      const loggerWarnSpy = jest.spyOn(worker['logger'], 'warn');

      const escrows = [
        {
          id: 'escrow-1',
          itemName: 'Camera',
          amount: 250,
          currency: 'USDC',
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
        {
          id: 'escrow-2',
          itemName: 'Laptop',
          amount: 1200,
          currency: 'USDC',
          buyerAddress: 'buyer-2',
          vendorAddress: 'vendor-2',
          state: 'SHIPPED',
          trackingId: 'TRK-2',
          deliveredAt: new Date('2026-01-02T00:00:00.000Z'),
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      escrowRepository.findAutoReleaseEligible.mockResolvedValue(escrows);
      disputeRepository.findByEscrow.mockResolvedValue(null);

      contractService.submitAutoRelease
        .mockResolvedValueOnce('tx-hash-1')
        .mockResolvedValueOnce('tx-hash-2');

      await worker.run(new Date('2026-05-26T00:00:00.000Z'));

      // All should succeed
      expect(escrowRepository.markAutoReleaseCompleted).toHaveBeenCalledTimes(
        2,
      );

      // Verify success count
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Batch complete: 2 succeeded, 0 failed out of 2 total',
      );

      // No warning should be logged
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });
  });
});
