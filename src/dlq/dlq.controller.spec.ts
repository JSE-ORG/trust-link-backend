import { Test, TestingModule } from '@nestjs/testing';
import { DlqController } from './dlq.controller';
import { DlqService } from './dlq.service';
import { ContractService } from '../stellar/contract.service';
import { ConfigService } from '../config/config.service';
import { FailedTransactionRecord } from './dlq.types';

describe('DlqController', () => {
  const autoReleaseRecord: FailedTransactionRecord = {
    id: 'failed-tx-1',
    operation: 'submitAutoRelease',
    escrowId: 'escrow-123',
    errorMessage: 'tx_bad_seq',
    ledgerFeedback: null,
    attempts: 1,
    status: 'PENDING_REVIEW',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    reviewedAt: null,
    replayedAt: null,
    lastReplayTxHash: null,
  };

  const buildController = async (
    autoReleaseSourceAddress: string | undefined,
  ) => {
    const dlq = {
      get: jest.fn(),
      replay: jest.fn(),
    } as unknown as jest.Mocked<DlqService>;

    const contract = {
      submitAutoRelease: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    const config = {
      get: jest.fn().mockReturnValue(autoReleaseSourceAddress),
    } as unknown as jest.Mocked<ConfigService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DlqController],
      providers: [
        { provide: DlqService, useValue: dlq },
        { provide: ContractService, useValue: contract },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    return {
      controller: moduleRef.get(DlqController),
      dlq,
      contract,
    };
  };

  describe('startup', () => {
    it('throws when AUTO_RELEASE_SOURCE_ADDRESS is unset', async () => {
      await expect(buildController(undefined)).rejects.toThrow(
        'AUTO_RELEASE_SOURCE_ADDRESS must be set',
      );
    });

    it('throws when AUTO_RELEASE_SOURCE_ADDRESS is an empty string', async () => {
      await expect(buildController('')).rejects.toThrow(
        'AUTO_RELEASE_SOURCE_ADDRESS must be set',
      );
    });
  });

  describe('POST /admin/dlq/:id/replay', () => {
    it('passes both the escrow id and the configured source address, and returns the tx hash', async () => {
      const { controller, dlq, contract } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );

      dlq.get.mockResolvedValue(autoReleaseRecord);
      contract.submitAutoRelease.mockResolvedValue('tx-hash-abc');
      dlq.replay.mockImplementation(async (id, replay) => {
        const txHash = await replay(autoReleaseRecord);
        return {
          ...autoReleaseRecord,
          status: 'REPLAYED',
          lastReplayTxHash: txHash,
        };
      });

      const result = await controller.replay('failed-tx-1');

      expect(contract.submitAutoRelease).toHaveBeenCalledWith(
        'escrow-123',
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      expect(result.status).toBe('REPLAYED');
      expect(result.lastReplayTxHash).toBe('tx-hash-abc');
    });

    it('rejects operations other than submitAutoRelease', async () => {
      const { controller, dlq, contract } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      const manualRecord = {
        ...autoReleaseRecord,
        operation: 'resolveDispute',
      };
      dlq.get.mockResolvedValue(manualRecord);
      dlq.replay.mockImplementation(async (_id, replay) => {
        await replay(manualRecord);
        throw new Error('unreachable');
      });

      await expect(controller.replay('failed-tx-1')).rejects.toThrow(
        'cannot be replayed automatically',
      );
      expect(contract.submitAutoRelease).not.toHaveBeenCalled();
    });
  });
});
