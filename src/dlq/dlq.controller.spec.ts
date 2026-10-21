import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { DlqController } from './dlq.controller';
import { ListFailedTransactionsQueryDto } from './dto/list-failed-transactions-query.dto';
import { DlqService } from './dlq.service';
import { ContractService } from '../stellar/contract.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import {
  AutoReleaseSourceNotConfiguredError,
  ConfigService,
} from '../config/config.service';
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
    // Issue #844: EscrowRepository.findContractEscrowId returns the contract's
    // own u64 (or null), where the controller previously read it off a Prisma
    // row itself.
    contractEscrowId: bigint | null = 42n,
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
      requireAutoReleaseSourceAddress: jest.fn((): string => {
        if (!autoReleaseSourceAddress) {
          throw new AutoReleaseSourceNotConfiguredError();
        }
        return autoReleaseSourceAddress;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DlqController],
      providers: [
        { provide: DlqService, useValue: dlq },
        { provide: ContractService, useValue: contract },
        { provide: ConfigService, useValue: config },
        {
          // Replay translates the DLQ record's backend UUID to the contract's
          // own u64 before calling auto_release.
          provide: EscrowRepository,
          useValue: {
            findContractEscrowId: jest.fn().mockResolvedValue(contractEscrowId),
          },
        },
      ],
    }).compile();

    return {
      controller: moduleRef.get(DlqController),
      dlq,
      contract,
      config,
    };
  };

  describe('missing AUTO_RELEASE_SOURCE_ADDRESS', () => {
    // The address is resolved when replay is called, not in the constructor.
    // `config.module.ts` declares AUTO_RELEASE_SOURCE_ADDRESS optional, so
    // throwing at construction stopped Nest instantiating the controller and
    // took the whole application down with it: NestFactory.create failed, so
    // `npm run start` and `npm run openapi:generate` both broke. Only the
    // replay endpoint should be unavailable when the address is unset.

    it('still constructs when the address is unset', async () => {
      await expect(buildController(undefined)).resolves.toBeDefined();
    });

    it('still constructs when the address is an empty string', async () => {
      await expect(buildController('')).resolves.toBeDefined();
    });

    it('rejects replay with 503 when the address is unset', async () => {
      const { controller, dlq, contract } = await buildController(undefined);
      dlq.get.mockResolvedValue(autoReleaseRecord);
      dlq.replay.mockImplementation(async (_id, replay) => {
        await replay(autoReleaseRecord);
        return autoReleaseRecord;
      });

      await expect(controller.replay(autoReleaseRecord.id)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(contract.submitAutoRelease).not.toHaveBeenCalled();
    });

    it('responds with HTTP 503 and an error body when AUTO_RELEASE_SOURCE_ADDRESS is not configured', async () => {
      const { controller, dlq } = await buildController(undefined);
      dlq.get.mockResolvedValue(autoReleaseRecord);
      dlq.replay.mockImplementation(async (_id, replay) => {
        await replay(autoReleaseRecord);
        return autoReleaseRecord;
      });

      const err = await controller.replay(autoReleaseRecord.id).catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getStatus()).toBe(503);
      expect(err.getResponse()).toMatchObject({ message: expect.any(String) });
    });

    it('rethrows unrelated errors from the source-address configuration check', async () => {
      const { controller, dlq, config } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      const originalError = new Error('configuration lookup failed');
      config.requireAutoReleaseSourceAddress.mockImplementation(() => {
        throw originalError;
      });
      dlq.get.mockResolvedValue(autoReleaseRecord);
      dlq.replay.mockImplementation(async (_id, replay) => {
        await replay(autoReleaseRecord);
        return autoReleaseRecord;
      });

      await expect(controller.replay(autoReleaseRecord.id)).rejects.toBe(
        originalError,
      );
    });
  });

  describe('POST /admin/dlq/:id/replay — no on-chain escrow id', () => {
    // Issue #844: the escrow lookup now goes through
    // EscrowRepository.findContractEscrowId, which returns the contract's u64
    // or null — "no such escrow" and "escrow not yet submitted on-chain" are
    // the same answer to the controller, so they are one case here.
    it('rejects replay with 409 when there is no contractEscrowId', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
        null,
      );
      dlq.get.mockResolvedValue(autoReleaseRecord);
      dlq.replay.mockImplementation(async (_id, replay) => {
        await replay(autoReleaseRecord);
        return autoReleaseRecord;
      });

      const err = await controller.replay('failed-tx-1').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getStatus()).toBe(409);
      expect(err.message).toContain('has no contractEscrowId');
      expect(err.message).toContain('escrow-123');
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

      // Replay translates the record's backend UUID to the contract's u64
      // before calling auto_release; the mocked lookup returns 42n.
      expect(contract.submitAutoRelease).toHaveBeenCalledWith(
        42n,
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      expect(result.status).toBe('REPLAYED');
      expect(result.lastReplayTxHash).toBe('tx-hash-abc');
    });

    it('rejects operations other than submitAutoRelease with 400', async () => {
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

      const err = await controller.replay('failed-tx-1').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('cannot be replayed automatically');
      expect(err.message).toContain('resolveDispute');
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
    it('passes query filters, page, and limit to dlq.list()', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      const paginated = {
        data: [autoReleaseRecord],
        total: 1,
        page: 2,
        limit: 10,
      };
      dlq.list.mockResolvedValue(paginated);

      const query = Object.assign(new ListFailedTransactionsQueryDto(), {
        status: 'PENDING_REVIEW',
        operation: 'submitAutoRelease',
        escrowId: 'escrow-123',
        page: 2,
        limit: 10,
      });
      const result = await controller.list(query);

      expect(dlq.list).toHaveBeenCalledWith(query);
      expect(result).toEqual(paginated);
    });

    it('passes empty query when no filters are provided', async () => {
      const { controller, dlq } = await buildController(
        'GAUTORELEASESOURCEADDRESS0000000000000000000000000000',
      );
      const emptyPaginated = { data: [], total: 0, page: 1, limit: 20 };
      dlq.list.mockResolvedValue(emptyPaginated);

      const query = new ListFailedTransactionsQueryDto();
      const result = await controller.list(query);

      expect(dlq.list).toHaveBeenCalledWith(query);
      expect(result).toEqual(emptyPaginated);
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
      } as FailedTransactionRecord;
      dlq.abandon.mockResolvedValue(abandonedRecord);

      const result = await controller.abandon('failed-tx-1');

      expect(dlq.abandon).toHaveBeenCalledWith('failed-tx-1');
      expect(result).toEqual(abandonedRecord);
    });
  });
});
