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
      list: jest.fn(),
      get: jest.fn(),
      abandon: jest.fn(),
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

    it('rejects replaying a record that is not PENDING_REVIEW', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      dlq.get.mockResolvedValue({
        ...autoReleaseRecord,
        status: 'REPLAYED',
      });
      dlq.replay.mockRejectedValue(
        new Error('Failed transaction failed-tx-1 is not pending review'),
      );

      await expect(controller.replay('failed-tx-1')).rejects.toThrow(
        'is not pending review',
      );
    });
  });

  describe('GET /admin/dlq', () => {
    it('passes query filters to dlq.list()', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      dlq.list.mockResolvedValue([autoReleaseRecord]);

      const result = await controller.list(
        'PENDING_REVIEW',
        'submitAutoRelease',
        'escrow-123',
      );

      expect(dlq.list).toHaveBeenCalledWith({
        status: 'PENDING_REVIEW',
        operation: 'submitAutoRelease',
        escrowId: 'escrow-123',
      });
      expect(result).toEqual([autoReleaseRecord]);
    });

    it('passes empty query when no filters are provided', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      dlq.list.mockResolvedValue([]);

      await controller.list();

      expect(dlq.list).toHaveBeenCalledWith({});
    });
  });

  describe('GET /admin/dlq/:id', () => {
    it('delegates to dlq.get() and returns the record', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      dlq.get.mockResolvedValue(autoReleaseRecord);

      const result = await controller.detail('failed-tx-1');

      expect(dlq.get).toHaveBeenCalledWith('failed-tx-1');
      expect(result).toEqual(autoReleaseRecord);
    });
  });

  describe('POST /admin/dlq/:id/abandon', () => {
    it('delegates to dlq.abandon() and returns the result', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      const abandonedRecord = {
        ...autoReleaseRecord,
        status: 'ABANDONED',
      };
      dlq.abandon.mockResolvedValue(abandonedRecord);

      const result = await controller.abandon('failed-tx-1');

      expect(dlq.abandon).toHaveBeenCalledWith('failed-tx-1');
      expect(result).toEqual(abandonedRecord);
    });
  });
});
