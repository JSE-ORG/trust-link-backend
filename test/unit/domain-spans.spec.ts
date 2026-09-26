import { Keypair } from '@stellar/stellar-sdk';
import { VendorProfileService } from '../../src/vendor/vendor-profile.service';
import { VendorProfileRepository } from '../../src/vendor/vendor-profile.repository';
import { EscrowService } from '../../src/escrow/escrow.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { BuyerDisputeService } from '../../src/escrow/buyer-dispute.service';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { ContractService } from '../../src/stellar/contract.service';
import { AutoReleaseWorker } from '../../src/workers/auto-release.worker';
import { EscrowRepository as WorkerEscrowRepository } from '../../src/escrow/escrow.repository';
import { createTracingMock, spanNames } from './tracing-mock';

/** A syntactically valid Stellar address — `Address` rejects placeholders. */
const ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/**
 * Span coverage for issues #823 (escrow/vendor operations), #824 (Stellar
 * operations) and #825 (worker and notification flows).
 *
 * Each test asserts the span name and its attributes, and that a failing
 * operation still surfaces through the wrapper rather than escaping the span.
 */
describe('tracing spans (#823, #824, #825)', () => {
  describe('#823 vendor operations', () => {
    function buildVendorService() {
      const tracing = createTracingMock();
      const repository = {
        findByAddress: jest.fn().mockResolvedValue({ id: 'p1' }),
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        upsert: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        updateNotificationPreferences: jest
          .fn()
          .mockResolvedValue({ trackingSettings: {} }),
        findNotificationPreferences: jest.fn().mockResolvedValue({}),
      } as unknown as jest.Mocked<VendorProfileRepository>;

      return {
        tracing,
        repository,
        service: new VendorProfileService(repository, tracing.service),
      };
    }

    it('records a span carrying the vendor address for a profile read', async () => {
      const { service, tracing } = buildVendorService();

      await service.getProfile('vendor-1');

      expect(tracing.withSpan).toHaveBeenCalledWith(
        'vendor.profile.get',
        { attributes: { 'trustlink.vendor.address': 'vendor-1' } },
        expect.any(Function),
      );
    });

    it('records a distinct span per vendor operation', async () => {
      const { service, tracing } = buildVendorService();

      await service.upsertProfile('vendor-1', {} as never);
      await service.getNotificationPreferences('vendor-1');

      expect(spanNames(tracing.withSpan)).toEqual([
        'vendor.profile.upsert',
        'vendor.profile.notify_prefs.get',
      ]);
    });

    it('surfaces a not-found failure through the span', async () => {
      const { service, repository, tracing } = buildVendorService();
      repository.findByAddress.mockResolvedValue(null);

      await expect(service.getProfile('vendor-1')).rejects.toThrow(
        'Vendor profile not found',
      );

      expect(tracing.withSpan).toHaveBeenCalledTimes(1);
    });
  });

  describe('#823 escrow operations', () => {
    function buildEscrowService() {
      const tracing = createTracingMock();
      const repository = {
        findById: jest.fn().mockResolvedValue({
          id: 'escrow-1',
          state: 'FUNDED',
        }),
      } as unknown as jest.Mocked<EscrowRepository>;

      return {
        tracing,
        service: new EscrowService(
          tracing.service,
          repository,
          {} as never,
          {} as never,
          {} as never,
        ),
      };
    }

    it('records a span carrying the escrow id', async () => {
      const { service, tracing } = buildEscrowService();

      await service.findById('escrow-1').catch(() => undefined);

      expect(tracing.withSpan).toHaveBeenCalledWith(
        'escrow.get',
        { attributes: { 'trustlink.escrow.id': 'escrow-1' } },
        expect.any(Function),
      );
    });

    it('opens a dispute inside its own span', async () => {
      const tracing = createTracingMock();
      const service = new BuyerDisputeService(
        {
          findById: jest.fn().mockResolvedValue(null),
        } as unknown as EscrowRepository,
        {} as unknown as DisputeRepository,
        {} as never,
        {} as never,
        {} as never,
        tracing.service,
      );

      await expect(
        service.openDispute('escrow-1', 'buyer-1', {} as never),
      ).rejects.toThrow();

      expect(tracing.withSpan).toHaveBeenCalledWith(
        'escrow.dispute.open',
        {
          attributes: {
            'trustlink.escrow.id': 'escrow-1',
            'trustlink.actor.address': 'buyer-1',
          },
        },
        expect.any(Function),
      );
    });
  });

  describe('#824 Stellar contract operations', () => {
    function buildContractService(config: Record<string, unknown> = {}) {
      const tracing = createTracingMock();
      const server = {
        getAccount: jest.fn().mockResolvedValue({
          sequence: '1',
          accountId: () => 'source',
        }),
        simulateTransaction: jest.fn().mockResolvedValue({}),
        prepareTransaction: jest.fn().mockImplementation((tx: unknown) => tx),
        sendTransaction: jest.fn().mockResolvedValue({
          status: 'SUCCESS',
          hash: 'tx-hash-1',
        }),
        pollTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
      };

      const service = new ContractService(
        server,
        {
          get: (key: string) =>
            key === 'SYSTEM_SIGNER_SECRET'
              ? (config[key] ?? Keypair.random().secret())
              : config[key],
        } as never,
        tracing.service,
      );

      return { tracing, server, service };
    }

    it('uses distinct spans for simulation, submission and confirmation', async () => {
      const { tracing, service } = buildContractService({
        CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        STELLAR_NETWORK: 'TESTNET',
      });

      await service.recordDelivery(1n, ADDRESS).catch(() => undefined);

      const names = spanNames(tracing.withSpan);
      expect(names).toEqual(
        expect.arrayContaining([
          'stellar.contract.record_delivery',
          'stellar.contract.invoke',
          'stellar.contract.simulate',
          'stellar.contract.submit',
          'stellar.contract.confirm',
        ]),
      );
    });

    it('records the contract escrow id and network, and no signing material', async () => {
      const { tracing, service } = buildContractService({
        CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        STELLAR_NETWORK: 'MAINNET',
        SYSTEM_SIGNER_SECRET: 'super-secret-key-material',
      });

      await service.recordDelivery(42n, ADDRESS).catch(() => undefined);

      const invokeCall = tracing.withSpan.mock.calls.find(
        (call) => call[0] === 'stellar.contract.invoke',
      );
      const attributes = (
        invokeCall?.[1] as { attributes: Record<string, unknown> }
      ).attributes;

      expect(attributes).toMatchObject({
        'trustlink.stellar.function': 'record_delivery',
        'trustlink.escrow.contract_id': '42',
        'trustlink.stellar.network': 'MAINNET',
      });

      const serialised = JSON.stringify(tracing.withSpan.mock.calls);
      expect(serialised).not.toContain('super-secret-key-material');
    });

    it('gives every auto-release retry attempt its own span', async () => {
      const { tracing, service, server } = buildContractService({
        CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        STELLAR_NETWORK: 'TESTNET',
      });

      // Fail twice with a sequence error, then succeed, forcing two retries.
      let sendCalls = 0;
      server.sendTransaction.mockImplementation(() => {
        sendCalls += 1;
        if (sendCalls < 3) {
          return Promise.resolve({
            status: 'ERROR',
            errorResultXdr: 'tx_bad_seq',
            hash: undefined,
          });
        }
        return Promise.resolve({ status: 'SUCCESS', hash: 'tx-hash-1' });
      });

      await service.submitAutoRelease(7n, ADDRESS, 2).catch(() => undefined);

      const attempts = tracing.withSpan.mock.calls.filter(
        (call) => call[0] === 'stellar.contract.auto_release.attempt',
      );

      expect(attempts.length).toBeGreaterThanOrEqual(2);
      expect(
        attempts.map(
          (call) =>
            (call[1] as { attributes: Record<string, number> }).attributes[
              'trustlink.stellar.attempt'
            ],
        ),
      ).toEqual([1, 2, 3]);
    });
  });

  describe('#825 worker runs', () => {
    it('records a root span per auto-release run and a child span per escrow', async () => {
      const tracing = createTracingMock();
      const repository = {
        findAutoReleaseEligible: jest
          .fn()
          .mockResolvedValue([
            { id: 'escrow-1', state: 'DELIVERED', contractEscrowId: null },
          ]),
        findByEscrow: jest.fn().mockResolvedValue(null),
      } as unknown as jest.Mocked<WorkerEscrowRepository>;

      const worker = new AutoReleaseWorker(
        repository,
        { findByEscrow: jest.fn().mockResolvedValue(null) } as never,
        {} as unknown as ContractService,
        { get: () => undefined } as never,
        tracing.service,
      );

      await worker.run();

      const names = spanNames(tracing.withSpan);
      expect(names[0]).toBe('worker.auto_release.run');
      expect(names).toContain('worker.auto_release.escrow');
    });
  });
});
