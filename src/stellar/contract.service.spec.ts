import { Account } from '@stellar/stellar-sdk';
import { ContractService } from './contract.service';
import { ContractCallFailedException } from './contract-call-failed.exception';
import { DEFAULT_AUTO_RELEASE_MAX_RETRIES } from './contract.constants';

// Minimal StellarServer stub — jest.fn() so each test controls its behaviour.
function makeServer() {
  return {
    loadAccount: jest.fn<Promise<{ sequence: string }>, [string]>(),
    submitTransaction: jest.fn<
      Promise<{ hash?: string; status?: string; resultXdr?: string }>,
      [Record<string, unknown>]
    >(),
  };
}

const SOURCE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
// The contract addresses escrows by its own u64, not the backend UUID.
const ESCROW = 42n;
const ADMIN = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('ContractService', () => {
  describe('submitAutoRelease — happy path', () => {
    it('returns the transaction hash on first attempt', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '100' });
      server.submitTransaction.mockResolvedValue({ hash: 'tx-hash-1' });

      const svc = new ContractService(server);
      const hash = await svc.submitAutoRelease(ESCROW, SOURCE);

      expect(hash).toBe('tx-hash-1');
      expect(server.loadAccount).toHaveBeenCalledTimes(1);
      expect(server.loadAccount).toHaveBeenCalledWith(SOURCE);
    });

    it('re-fetches the account on every attempt (not just once)', async () => {
      const server = makeServer();
      // First two loadAccount calls return stale sequence; third returns fresh.
      server.loadAccount
        .mockResolvedValueOnce({ sequence: '99' })
        .mockResolvedValueOnce({ sequence: '100' })
        .mockResolvedValueOnce({ sequence: '101' });

      // First two submits fail with a sequence error; third succeeds.
      server.submitTransaction
        .mockRejectedValueOnce(new Error('tx_bad_seq'))
        .mockRejectedValueOnce(new Error('tx_bad_seq'))
        .mockResolvedValueOnce({ hash: 'tx-hash-ok' });

      const svc = new ContractService(server);
      const hash = await svc.submitAutoRelease(ESCROW, SOURCE, 2);

      expect(hash).toBe('tx-hash-ok');
      // loadAccount must be called once per attempt, not once total.
      expect(server.loadAccount).toHaveBeenCalledTimes(3);
    });
  });

  describe('submitAutoRelease — sequence error retries', () => {
    it('retries up to maxRetries on tx_bad_seq then throws', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '1' });
      server.submitTransaction.mockRejectedValue(new Error('tx_bad_seq'));

      const svc = new ContractService(server);

      await expect(
        svc.submitAutoRelease(ESCROW, SOURCE, DEFAULT_AUTO_RELEASE_MAX_RETRIES),
      ).rejects.toThrow('Max retries exceeded');

      // 1 initial attempt + DEFAULT_AUTO_RELEASE_MAX_RETRIES retries
      expect(server.loadAccount).toHaveBeenCalledTimes(
        1 + DEFAULT_AUTO_RELEASE_MAX_RETRIES,
      );
    });

    it('retries exactly maxRetries times before throwing Max retries exceeded', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '1' });
      server.submitTransaction.mockRejectedValue(
        new Error('sequence number mismatch'),
      );

      const svc = new ContractService(server);
      const maxRetries = 1;

      await expect(
        svc.submitAutoRelease(ESCROW, SOURCE, maxRetries),
      ).rejects.toThrow('Max retries exceeded');

      expect(server.loadAccount).toHaveBeenCalledTimes(1 + maxRetries);
    });

    it('succeeds on final retry if submit eventually succeeds', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '5' });
      server.submitTransaction
        .mockRejectedValueOnce(new Error('tx_bad_seq'))
        .mockResolvedValueOnce({ hash: 'tx-retry-ok' });

      const svc = new ContractService(server);
      const hash = await svc.submitAutoRelease(ESCROW, SOURCE, 1);

      expect(hash).toBe('tx-retry-ok');
      expect(server.loadAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('submitAutoRelease — non-sequence errors', () => {
    it('wraps non-sequence errors in ContractCallFailedException without retrying', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '1' });
      server.submitTransaction.mockRejectedValue(
        new Error('connection refused'),
      );

      const svc = new ContractService(server);

      await expect(
        svc.submitAutoRelease(ESCROW, SOURCE),
      ).rejects.toBeInstanceOf(ContractCallFailedException);

      // No retries — loadAccount called once only
      expect(server.loadAccount).toHaveBeenCalledTimes(1);
    });

    it('re-throws ContractCallFailedException immediately without retrying', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '1' });
      server.submitTransaction.mockResolvedValue({ status: 'ERROR' });

      const svc = new ContractService(server);

      await expect(
        svc.submitAutoRelease(ESCROW, SOURCE),
      ).rejects.toBeInstanceOf(ContractCallFailedException);

      expect(server.loadAccount).toHaveBeenCalledTimes(1);
    });

    it('throws ContractCallFailedException when hash is missing', async () => {
      const server = makeServer();
      server.loadAccount.mockResolvedValue({ sequence: '1' });
      server.submitTransaction.mockResolvedValue({ status: 'OK' }); // no hash

      const svc = new ContractService(server);

      await expect(svc.submitAutoRelease(ESCROW, SOURCE)).rejects.toThrow(
        'Missing transaction hash',
      );
    });
  });

  describe('submitAutoRelease — no server configured', () => {
    it('throws ContractCallFailedException when server is not injected', async () => {
      const svc = new ContractService(undefined);

      await expect(svc.submitAutoRelease(ESCROW, SOURCE)).rejects.toThrow(
        'Stellar server is not configured',
      );
    });
  });

  describe('resolveDispute', () => {
    it('returns the hash on success', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({ hash: 'dispute-hash' });

      const svc = new ContractService(server);
      const hash = await svc.resolveDispute(ESCROW, 'RELEASE', ADMIN);

      expect(hash).toBe('dispute-hash');
    });

    it('throws when status is ERROR', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({ status: 'ERROR' });

      const svc = new ContractService(server);
      await expect(
        svc.resolveDispute(ESCROW, 'REFUND', ADMIN),
      ).rejects.toBeInstanceOf(ContractCallFailedException);
    });

    it('throws when hash is missing', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({});

      const svc = new ContractService(server);
      await expect(
        svc.resolveDispute(ESCROW, 'RELEASE', ADMIN),
      ).rejects.toThrow('Missing transaction hash');
    });
  });

  describe('getEscrowState', () => {
    it('returns UNKNOWN and exists=false when server is not configured', async () => {
      const svc = new ContractService(undefined);
      const result = await svc.getEscrowState(ESCROW);
      expect(result).toEqual({ state: 'UNKNOWN', exists: false });
    });

    it('returns UNKNOWN and exists=false when submitTransaction throws', async () => {
      const server = makeServer();
      server.submitTransaction.mockRejectedValue(new Error('network error'));

      const svc = new ContractService(server);
      const result = await svc.getEscrowState(ESCROW);
      expect(result).toEqual({ state: 'UNKNOWN', exists: false });
    });

    it('returns UNKNOWN and exists=false when status is ERROR', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({ status: 'ERROR' });

      const svc = new ContractService(server);
      const result = await svc.getEscrowState(ESCROW);
      expect(result).toEqual({ state: 'UNKNOWN', exists: false });
    });

    it('returns resultXdr as state and exists=true on success', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({
        status: 'OK',
        resultXdr: 'FUNDED',
      });

      const svc = new ContractService(server);
      const result = await svc.getEscrowState(ESCROW);
      expect(result).toEqual({ state: 'FUNDED', exists: true });
    });
  });

  describe('cancelEscrowOnChain', () => {
    it('returns the hash on success', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({ hash: 'cancel-hash' });

      const svc = new ContractService(server);
      expect(await svc.cancelEscrowOnChain(ESCROW, ADMIN)).toBe('cancel-hash');
    });

    it('throws when server is not configured', async () => {
      const svc = new ContractService(undefined);
      await expect(svc.cancelEscrowOnChain(ESCROW, ADMIN)).rejects.toThrow(
        'Stellar server is not configured',
      );
    });

    it('throws ContractCallFailedException when resultXdr is TxFailed', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({ resultXdr: 'TxFailed' });

      const svc = new ContractService(server);
      await expect(
        svc.cancelEscrowOnChain(ESCROW, ADMIN),
      ).rejects.toBeInstanceOf(ContractCallFailedException);
    });
  });

  describe('recordDelivery', () => {
    it('returns the hash on success', async () => {
      const server = makeServer();
      server.submitTransaction.mockResolvedValue({ hash: 'delivery-hash' });

      const svc = new ContractService(server);
      expect(await svc.recordDelivery(ESCROW, ADMIN)).toBe('delivery-hash');
    });

    it('throws when server is not configured', async () => {
      const svc = new ContractService(undefined);
      await expect(svc.recordDelivery(ESCROW, ADMIN)).rejects.toThrow(
        'Stellar server is not configured',
      );
    });
  });

  describe('Soroban RPC lifecycle (Issue #478)', () => {
    function makeSorobanRpcServer() {
      return {
        getAccount: jest.fn().mockResolvedValue({
          sequenceNumber: () => '10',
          accountId: () => SOURCE,
        }),
        simulateTransaction: jest
          .fn()
          .mockResolvedValue({ transactionData: {} }),
        prepareTransaction: jest
          .fn()
          .mockImplementation((tx) => Promise.resolve(tx)),
        sendTransaction: jest.fn().mockResolvedValue({
          status: 'PENDING',
          hash: 'soroban-hash-1',
        }),
        getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
        pollTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
      };
    }

    it('executes successful Soroban contract invocation flow', async () => {
      const server = makeSorobanRpcServer();
      const svc = new ContractService(server);

      const disputeHash = await svc.resolveDispute(ESCROW, 'RELEASE', ADMIN);
      expect(disputeHash).toBe('soroban-hash-1');
      expect(server.getAccount).toHaveBeenCalledWith(SOURCE);
      expect(server.simulateTransaction).toHaveBeenCalled();
      expect(server.prepareTransaction).toHaveBeenCalled();
      expect(server.sendTransaction).toHaveBeenCalled();
      expect(server.pollTransaction).toHaveBeenCalledWith('soroban-hash-1');

      const releaseHash = await svc.submitAutoRelease(ESCROW, SOURCE);
      expect(releaseHash).toBe('soroban-hash-1');

      const cancelHash = await svc.cancelEscrowOnChain(ESCROW, ADMIN);
      expect(cancelHash).toBe('soroban-hash-1');

      const deliveryHash = await svc.recordDelivery(ESCROW, ADMIN);
      expect(deliveryHash).toBe('soroban-hash-1');
    });

    it('handles simulation failure', async () => {
      const server = makeSorobanRpcServer();
      server.simulateTransaction.mockResolvedValue({
        error: 'Host error: ContractError(101)',
      });

      const svc = new ContractService(server);
      await expect(
        svc.resolveDispute(ESCROW, 'RELEASE', ADMIN),
      ).rejects.toThrow(ContractCallFailedException);
    });

    it('handles transaction preparation failure', async () => {
      const server = makeSorobanRpcServer();
      server.prepareTransaction.mockRejectedValue(
        new Error('Resource limits exceeded'),
      );

      const svc = new ContractService(server);
      await expect(
        svc.resolveDispute(ESCROW, 'RELEASE', ADMIN),
      ).rejects.toThrow(ContractCallFailedException);
    });

    it('handles submission error status', async () => {
      const server = makeSorobanRpcServer();
      server.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResultXdr: 'tx_failed',
      });

      const svc = new ContractService(server);
      await expect(
        svc.resolveDispute(ESCROW, 'RELEASE', ADMIN),
      ).rejects.toThrow(ContractCallFailedException);
    });

    it('handles polling failure and decodes contract error', async () => {
      const server = makeSorobanRpcServer();
      server.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'soroban-hash-poll-fail',
      });
      server.pollTransaction.mockResolvedValue({
        status: 'FAILED',
        resultXdr: 'Error(Contract, #404)',
      });

      const svc = new ContractService(server);
      await expect(
        svc.resolveDispute(ESCROW, 'RELEASE', ADMIN),
      ).rejects.toThrow(ContractCallFailedException);
    });

    it('retries on sequence error and re-fetches account on each attempt', async () => {
      const server = makeSorobanRpcServer();
      server.sendTransaction
        .mockResolvedValueOnce({
          status: 'ERROR',
          errorResultXdr: 'tx_bad_seq',
        })
        .mockResolvedValueOnce({
          status: 'PENDING',
          hash: 'soroban-retry-success-hash',
        });

      const svc = new ContractService(server);
      const hash = await svc.submitAutoRelease(ESCROW, SOURCE, 2);

      expect(hash).toBe('soroban-retry-success-hash');
      expect(server.getAccount).toHaveBeenCalledTimes(2);
    });

    it('simulates getEscrowState with Soroban RPC', async () => {
      const server = makeSorobanRpcServer();
      const svc = new ContractService(server);

      const resultOk = await svc.getEscrowState(ESCROW);
      expect(resultOk).toEqual({ state: 'CREATED', exists: true });

      server.simulateTransaction.mockResolvedValue({
        error: 'Contract error',
      });
      const resultFail = await svc.getEscrowState(ESCROW);
      expect(resultFail).toEqual({ state: 'UNKNOWN', exists: false });
    });

    it('fetchAccount returns the SDK Account instance directly when getAccount does', async () => {
      const server = makeSorobanRpcServer();
      const realAccount = new Account(SOURCE, '55');
      server.getAccount.mockResolvedValue(realAccount);

      const svc = new ContractService(server);
      const hash = await svc.resolveDispute(ESCROW, 'RELEASE', ADMIN);

      expect(hash).toBe('soroban-hash-1');
    });

    it('falls back to getTransaction when the server has no pollTransaction', async () => {
      const server = makeSorobanRpcServer();
      // @ts-expect-error — exercising the pollTransactionStatus fallback path
      delete server.pollTransaction;
      server.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const svc = new ContractService(server);
      const hash = await svc.resolveDispute(ESCROW, 'RELEASE', ADMIN);

      expect(hash).toBe('soroban-hash-1');
      expect(server.getTransaction).toHaveBeenCalledWith('soroban-hash-1');
    });
  });

  describe('submitAutoRelease — invalid maxRetries', () => {
    it('throws immediately without any network call when maxRetries is negative', async () => {
      const server = makeServer();
      const svc = new ContractService(server);

      await expect(
        svc.submitAutoRelease(ESCROW, SOURCE, -1),
      ).rejects.toThrow('Max retries exceeded');
      expect(server.loadAccount).not.toHaveBeenCalled();
    });
  });
});
