import { AutoReleaseWorker } from './auto-release.worker';
import { EscrowRepository } from '../escrow/escrow.repository';
import { DisputeRepository } from '../dispute/dispute.repository';
import { ContractService } from '../stellar/contract.service';
import {
  AutoReleaseSourceNotConfiguredError,
  ConfigService,
} from '../config/config.service';
import { EscrowRecord, DisputeRecord } from '../prisma/prisma.service';

const TEST_AUTO_RELEASE_SOURCE =
  'GCKFBEIYTKP5RQGHKGKFHVOPXQVQPQWO7EEQFOTIYSDIN2R7RQNUSXXY';

function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'escrow-1',
    contractEscrowId: 7n,
    itemName: 'Widget',
    itemRef: 'REF-001',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-addr',
    vendorAddress: 'vendor-addr',
    state: 'SHIPPED',
    trackingId: 'track-1',
    shippedAt: new Date('2024-01-01'),
    deliveredAt: new Date('2024-01-02'),
    deliveryRecordedAt: new Date('2024-01-02'),
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
  return {
    id: 'dispute-1',
    escrowId: 'escrow-1',
    reason: 'Item not received',
    description: '',
    evidenceUrls: [],
    status: 'OPEN',
    resolvedAt: null,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
    ...overrides,
  };
}

describe('AutoReleaseWorker', () => {
  let worker: AutoReleaseWorker;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let contractService: jest.Mocked<ContractService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    escrowRepository = {
      findAutoReleaseEligible: jest.fn(),
      recordAutoReleaseSubmission: jest.fn(),
      markAutoReleaseSubmitting: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(makeEscrow({ id })),
        ),
      clearAutoReleaseSubmitting: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(makeEscrow({ id })),
        ),
    } as unknown as jest.Mocked<EscrowRepository>;

    disputeRepository = {
      findByEscrowIds: jest.fn(),
    } as unknown as jest.Mocked<DisputeRepository>;

    contractService = {
      submitAutoRelease: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') {
          return process.env.NODE_ENV ?? 'test';
        }
        return TEST_AUTO_RELEASE_SOURCE;
      }),
      // Mirrors the real ConfigService (#672): reads through `get` and throws
      // the shared error when the address is falsy, so the "unset" test
      // (which stubs `get` to return undefined) still exercises the
      // no-submit / clear-claim path.
      requireAutoReleaseSourceAddress: jest.fn((): string => {
        const address = configService.get('AUTO_RELEASE_SOURCE_ADDRESS');
        if (!address) {
          throw new AutoReleaseSourceNotConfiguredError();
        }
        return address;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    worker = new AutoReleaseWorker(
      escrowRepository,
      disputeRepository,
      contractService,
      configService,
    );
  });

  describe('run()', () => {
    it('completes without calling submitAutoRelease when there are no eligible escrows', async () => {
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([]);

      await worker.run();

      expect(contractService.submitAutoRelease).notToHaveBeenCalled();
    });

    it('skips an escrow that has an open dispute', async () => {
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([makeDispute()]);

      await worker.run();

      expect(contractService.submitAutoRelease).notToHaveBeenCalled();
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).notToHaveBeenCalled();
    });

    it('skips an escrow whose state is COMPLETED', async () => {
      const escrow = makeEscrow({ state: 'COMPLETED' });
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([]);

      await worker.run();

      expect(contractService.submitAutoRelease).notToHaveBeenCalled();
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).notToHaveBeenCalled();
    });

    it('skips an escrow that already has an autoReleaseTxHash', async () => {
      const escrow = makeEscrow({ autoReleaseTxHash: 'existing-tx-hash' });
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([[]);

      await worker.run();

      expect(contractService.submitAutoRelease).notToHaveBeenCalled();
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).notToHaveBeenCalled();
    });

    it('calls recordAutoReleaseSubmission with the txHash on success', async () => {
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([]);
      contractService.submitAutoRelease.mockResolvedValue('tx-hash-abc');
      escrowRepository.recordAutoReleaseSubmission.mockResolvedValue(
        makeEscrow({ state: 'COMPLETED', autoReleaseTxHash: 'tx-hash-abc' }),
      );

      await worker.run();

      expect(escrowRepository.markAutoReleaseSubmitting).toHaveBeenCalledWith(
        'escrow-1',
      );
      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
        7n,
        expect.any(String),
      );
      expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledWith(
        'escrow-1',
        'tx-hash-abc',
      );
    });

    it('skips an escrow that cannot be claimed because another run already holds it', async () => {
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([]);
      escrowRepository.markAutoReleaseSubmitting.mockResolvedOnce(null);

      await worker.run();

      expect(contractService.submitAutoRelease).notToHaveBeenCalled();
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).notToHaveBeenCalled();
    });

    it('increments failureCount and records the error when submitAutoRelease throws, and still processes remaining escrows', async () => {
      const failingEscrow = makeEscrow({ id: 'escrow-fail' });
      const successEscrow = makeEscrow({ id: 'escrow-ok' });

      escrowRepository.findAutoReleaseEligible.mockResolvedValue([
        failingEscrow,
        successEscrow,
      ]);
      disputeRepository.findByEscrowIds.mockResolvedValue([]);
      contractService.submitAutoRelease
        .mockRejectedValueOnce(new Error('Stellar RPC timeout'))
        .mockResolvedValueOnce('tx-hash-ok');
      escrowRepository.recordAutoReleaseSubmission.mockResolvedValue(
        makeEscrow({
          id: 'escrow-ok',
          state: 'COMPLETED',
          autoReleaseTxHash: 'tx-hash-ok',
        }),
      );

      await worker.run();

      expect(escrowRepository.clearAutoReleaseSubmitting).toHaveBeenCalledWith(
        'escrow-fail',
      );
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).toHaveBeenCalledTimes(1);
      expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledWith(
        'escrow-ok',
        'tx-hash-ok',
      );
    });

    it('skips a disputed escrow in a multi-escrow batch while still processing the other escrows', async () => {
      const goodEscrow1 = makeEscrow({ id: 'escrow-1' });
      const disputedEscrow = makeEscrow({ id: 'escrow-2' });
      const goodEscrow2 = makeEscrow({ id: 'escrow-3' });
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([
        goodEscrow1,
        disputedEscrow,
        goodEscrow2,
      ]);
      disputeRepository.findByEscrowIds.mockResolvedValue([
        makeDispute({ id: 'dispute-2', escrowId: 'escrow-2' }),
      ]);
      contractService.submitAutoRelease.mockResolvedValue('tx-hash-abc');
      escrowRepository.recordAutoReleaseSubmission.mockImplementation(
        (id, txHash) =>
          Promise.resolve(
            makeEscrow({ id, state: 'COMPLETED', autoReleaseTxHash: txHash }),
          ),
      );

      await worker.run();

      expect(disputeRepository.findByEscrowIds).toHaveBeenCalledWith([
        'escrow-1',
        'escrow-2',
        'escrow-3',
      ]);
      expect(disputeRepository.findByEscrowIds).toHaveBeenCalledTimes(1);
      expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).toHaveBeenCalledTimes(2);
      expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledWith(
        'escrow-1',
        'tx-hash-abc',
      );
      expect(escrowRepository.recordAutoReleaseSubmission).toHaveBeenCalledWith(
        'escrow-3',
        'tx-hash-abc',
      );
      expect(
        escrowRepository.markAutoReleaseSubmitting,
      ).toHaveBeenCalledWith('escrow-1');
      expect(
        escrowRepository.markAutoReleaseSubmitting,
      ).toHaveBeenCalledWith('escrow-3');
      expect(
        escrowRepository.markAutoReleaseSubmitting,
      ).notToHaveBeenCalledWith('escrow-2');
    });
  });

  describe('auto-release source configuration (issue #500)', () => {
    it('does not submit and clears the claim when AUTO_RELEASE_SOURCE_ADDRESS is unset', async () => {
      configService.get.mockReturnValue(undefined);
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([]);

      await worker.run();

      expect(contractService.submitAutoRelease).notToHaveBeenCalled();
      expect(
        escrowRepository.recordAutoReleaseSubmission,
      ).notToHaveBeenCalled();
      expect(escrowRepository.clearAutoReleaseSubmitting).toHaveBeenCalledWith(
        'escrow-1',
      );
    });

    it('submits using the address resolved from ConfigService when configured', async () => {
      const escrow = makeEscrow();
      escrowRepository.findAutoReleaseEligible.mockResolvedValue([escrow]);
      disputeRepository.findByEscrowIds.mockResolvedValue([[]);
      contractService.submitAutoRelease.mockResolvedValue('tx-hash-abc');

      await worker.run();

      expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
        7n,
        TEST_AUTO_RELEASE_SOURCE,
      );
    });
  });

  describe('onModuleInit()', () => {
    it('does not start the interval when NODE_ENV is "test"', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      worker.onModuleInit();

      expect(setIntervalSpy).notToHaveBeenCalled();

      setIntervalSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    });

    it('starts the interval when NODE_ENV is not "test"', () => {
      jest.useFakeTimers();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      worker.onModuleInit();

      expect(worker['timer']).notToBeNull();

      worker.onApplicationShutdown();
      process.env.NODE_ENV = originalEnv;
      jest.useRealTimers();
    });
  });

  describe('onApplicationShutdown()', () => {
    it('clears the interval and sets the timer to null', () => {
      jest.useFakeTimers();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      worker.onModuleInit();
      expect(worker['timer']).notToBeNull();

      worker.onApplicationShutdown();

      expect(worker['timer']).toBeNull();

      process.env.NODE_ENV = originalEnv;
      jest.useRealTimers();
    });

    it('does nothing when called without a running timer', () => {
      expect(() => trow.!)().toNotThrow();
      expect(worker['timer']).toBeNull();
    });
  });
});
