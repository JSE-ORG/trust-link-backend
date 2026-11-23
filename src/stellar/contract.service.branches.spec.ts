/**
 * Tests for ContractService error-decoding and low-level branches (issue #1125).
 *
 * Covers: decodeSimulationError (×2), decodeTransactionError, isSequenceError,
 * simulateTransaction, submitTransaction, getEscrowStateInternal.
 */

import { Keypair, rpc, Transaction } from '@stellar/stellar-sdk';
import { ContractCallFailedException } from '../stellar/contract-call-failed.exception';
import { ContractService } from '../stellar/contract.service';

const VALID_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const VALID_ADDRESS =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

type Priv = Record<string, (...args: unknown[]) => unknown>;
type Account = { sequenceNumber(): string };

function makeService(server?: object, config?: object): ContractService {
  return new ContractService(server, config as never, undefined);
}

// ── isSequenceError ───────────────────────────────────────────────────────────

describe('ContractService.isSequenceError', () => {
  let svc: ContractService;
  beforeEach(() => {
    svc = makeService();
  });

  it('returns true for a string containing "sequence"', () => {
    expect(
      (svc as unknown as Priv)['isSequenceError']('bad sequence error'),
    ).toBe(true);
  });

  it('returns true for a string containing "tx_bad_seq"', () => {
    expect((svc as unknown as Priv)['isSequenceError']('TX_BAD_SEQ')).toBe(
      true,
    );
  });

  it('returns false for an unrelated string', () => {
    expect((svc as unknown as Priv)['isSequenceError']('timeout error')).toBe(
      false,
    );
  });

  it('returns true for an Error with sequence in message', () => {
    expect(
      (svc as unknown as Priv)['isSequenceError'](new Error('tx_bad_seq')),
    ).toBe(true);
  });

  it('returns false for an Error without sequence', () => {
    expect(
      (svc as unknown as Priv)['isSequenceError'](
        new Error('connection reset'),
      ),
    ).toBe(false);
  });

  it('returns false for a non-string non-Error value', () => {
    expect((svc as unknown as Priv)['isSequenceError'](42)).toBe(false);
  });
});

// ── decodeSimulationError ─────────────────────────────────────────────────────

describe('ContractService.decodeSimulationError', () => {
  let svc: ContractService;
  beforeEach(() => {
    svc = makeService();
  });

  it('returns the error field when simResult has an error', () => {
    const simResult = { error: 'contract panic' };
    const result = (svc as unknown as Priv)['decodeSimulationError'](simResult);
    expect(result).toBe('contract panic');
  });

  it('returns "Unknown simulation error" when error field is absent', () => {
    const simResult = {};
    const result = (svc as unknown as Priv)['decodeSimulationError'](simResult);
    expect(result).toBe('Unknown simulation error');
  });
});

// ── decodeTransactionError ────────────────────────────────────────────────────

describe('ContractService.decodeTransactionError', () => {
  let svc: ContractService;
  beforeEach(() => {
    svc = makeService();
  });

  it('returns resultXdr string when present', () => {
    const txResponse = { resultXdr: 'AAAAAQAAAAAAAAAAAAAAAgAAAAIAAAAA' };
    expect((svc as unknown as Priv)['decodeTransactionError'](txResponse)).toBe(
      'AAAAAQAAAAAAAAAAAAAAAgAAAAIAAAAA',
    );
  });

  it('returns "Transaction failed on chain" when resultXdr is absent', () => {
    expect((svc as unknown as Priv)['decodeTransactionError']({})).toBe(
      'Transaction failed on chain',
    );
  });
});

// ── simulateTransaction ───────────────────────────────────────────────────────

describe('ContractService.simulateTransaction', () => {
  it('throws ContractCallFailedException when server has no simulateTransaction', async () => {
    const server = { sendTransaction: jest.fn() };
    const svc = makeService(server);
    await expect(
      (svc as unknown as Priv)['simulateTransaction']({}, 'fn'),
    ).rejects.toThrow(ContractCallFailedException);
  });

  it('calls server.simulateTransaction when available', async () => {
    const simResult = { result: {} };
    const server = {
      simulateTransaction: jest.fn().mockResolvedValue(simResult),
    };
    const svc = makeService(server);
    const result = await (svc as unknown as Priv)['simulateTransaction'](
      {},
      'fn',
    );
    expect(result).toBe(simResult);
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── submitTransaction ─────────────────────────────────────────────────────────

describe('ContractService.submitTransaction', () => {
  it('throws ContractCallFailedException when server has no sendTransaction', async () => {
    const server = { simulateTransaction: jest.fn() };
    const svc = makeService(server);
    await expect(
      (svc as unknown as Priv)['submitTransaction']({}, 'fn'),
    ).rejects.toThrow(ContractCallFailedException);
  });

  it('calls server.sendTransaction when available', async () => {
    const sendResult = { status: 'PENDING', hash: 'abc' };
    const server = { sendTransaction: jest.fn().mockResolvedValue(sendResult) };
    const svc = makeService(server);
    const result = await (svc as unknown as Priv)['submitTransaction'](
      {},
      'fn',
    );
    expect(result).toBe(sendResult);
  });
});

// ── getEscrowStateInternal ────────────────────────────────────────────────────

describe('ContractService.getEscrowState', () => {
  it('returns {exists:false} early when server is not configured', async () => {
    const svc = makeService(undefined);
    const result = await svc.getEscrowState(1n);
    expect(result.exists).toBe(false);
  });

  it('defaults state to CREATED when legacy submitTransaction omits resultXdr', async () => {
    const server = {
      submitTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    };
    const svc = makeService(server);

    await expect(svc.getEscrowState(5n)).resolves.toEqual({
      state: 'CREATED',
      exists: true,
    });
  });

  it('returns {state:UNKNOWN, exists:false} when simulation throws', async () => {
    const server = {
      simulateTransaction: jest.fn().mockRejectedValue(new Error('rpc down')),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'CONTRACT_ID' ? VALID_CONTRACT_ID : 'TESTNET',
      ),
    };
    const svc = makeService(server, config);

    await expect(svc.getEscrowState(5n)).resolves.toEqual({
      state: 'UNKNOWN',
      exists: false,
    });
  });
});

// ── Issue #1222: remaining ContractService branches ───────────────────────────

describe('ContractService remaining branches (issue #1222)', () => {
  it('decodeSimulationError returns "Unknown simulation error" when isSimulationError is true with empty error text', () => {
    const svc = makeService();
    const isSimSpy = jest
      .spyOn(rpc.Api, 'isSimulationError')
      .mockReturnValueOnce(true);
    try {
      const msg = (svc as unknown as Priv)['decodeSimulationError']({
        error: '',
      });
      expect(msg).toBe('Unknown simulation error');
    } finally {
      isSimSpy.mockRestore();
    }
  });

  describe('fetchAccount', () => {
    it('throws ContractCallFailedException when server is not configured', async () => {
      const svc = makeService(undefined);
      await expect(
        (svc as unknown as Priv)['fetchAccount'](VALID_ADDRESS),
      ).rejects.toThrow(ContractCallFailedException);
    });

    it('reads sequence from getAccount sequenceNumber() and sequence property', async () => {
      const serverWithFn = {
        getAccount: jest
          .fn()
          .mockResolvedValue({ sequenceNumber: () => '123' }),
      };
      const svc1 = makeService(serverWithFn);
      const acc1 = (await (svc1 as unknown as Priv)['fetchAccount'](
        VALID_ADDRESS,
      )) as Account;
      expect(acc1.sequenceNumber()).toBe('123');

      const serverWithProp = {
        getAccount: jest.fn().mockResolvedValue({ sequence: 456 }),
      };
      const svc2 = makeService(serverWithProp);
      const acc2 = (await (svc2 as unknown as Priv)['fetchAccount'](
        VALID_ADDRESS,
      )) as Account;
      expect(acc2.sequenceNumber()).toBe('456');

      const serverWithEmpty = {
        getAccount: jest.fn().mockResolvedValue({}),
      };
      const svc3 = makeService(serverWithEmpty);
      const acc3 = (await (svc3 as unknown as Priv)['fetchAccount'](
        VALID_ADDRESS,
      )) as Account;
      expect(acc3.sequenceNumber()).toBe('0');
    });

    it('falls back to loadAccount when getAccount is absent', async () => {
      const server = {
        loadAccount: jest.fn().mockResolvedValue({ sequence: '789' }),
      };
      const svc = makeService(server);
      const acc = (await (svc as unknown as Priv)['fetchAccount'](
        VALID_ADDRESS,
      )) as Account;
      expect(acc.sequenceNumber()).toBe('789');
    });
  });

  describe('prepareTransaction', () => {
    it('uses rpc.assembleTransaction when server.prepareTransaction is absent and simResult is provided', async () => {
      const assembledTx = { assembled: true } as unknown as Transaction;
      const assembleSpy = jest
        .spyOn(rpc, 'assembleTransaction')
        .mockReturnValueOnce({
          build: () => assembledTx,
        } as unknown as ReturnType<typeof rpc.assembleTransaction>);

      try {
        const svc = makeService({});
        const tx = { raw: true } as unknown as Transaction;
        const simResult = {
          result: {},
        } as unknown as rpc.Api.SimulateTransactionResponse;

        const out = await (svc as unknown as Priv)['prepareTransaction'](
          tx,
          simResult,
        );
        expect(out).toBe(assembledTx);
        expect(assembleSpy).toHaveBeenCalledWith(tx, simResult);
      } finally {
        assembleSpy.mockRestore();
      }
    });

    it('returns original tx when neither prepareTransaction nor simResult is available', async () => {
      const svc = makeService({});
      const tx = { raw: true } as unknown as Transaction;
      const out = await (svc as unknown as Priv)['prepareTransaction'](
        tx,
        undefined,
      );
      expect(out).toBe(tx);
    });
  });

  describe('invokeContractInternal', () => {
    function makeConfig(overrides: Record<string, string | undefined> = {}) {
      const values: Record<string, string | undefined> = {
        CONTRACT_ID: VALID_CONTRACT_ID,
        STELLAR_NETWORK: 'TESTNET',
        ...overrides,
      };
      return {
        get: jest.fn((key: string) => values[key]),
      };
    }

    it('signs transaction with valid SYSTEM_SIGNER_SECRET and derives source public key from signer', async () => {
      const signer = Keypair.random();
      const signSpy = jest.fn();
      const preparedTx = { sign: signSpy } as unknown as Transaction;
      const server = {
        getAccount: jest.fn().mockResolvedValue({ sequence: '10' }),
        simulateTransaction: jest.fn().mockResolvedValue({ result: {} }),
        prepareTransaction: jest.fn().mockResolvedValue(preparedTx),
        sendTransaction: jest
          .fn()
          .mockResolvedValue({ status: 'PENDING', hash: 'tx-signed-1' }),
        pollTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
      };
      const svc = makeService(
        server,
        makeConfig({ SYSTEM_SIGNER_SECRET: signer.secret() }),
      );

      const hash = await svc.recordDelivery(1n, VALID_ADDRESS);

      expect(hash).toBe('tx-signed-1');
      expect(server.getAccount).toHaveBeenCalledWith(signer.publicKey());
      expect(signSpy).toHaveBeenCalledWith(signer);
    });

    it('warns on unparseable SYSTEM_SIGNER_SECRET and rethrows ContractCallFailedException from prepareTransaction', async () => {
      const server = {
        getAccount: jest.fn().mockResolvedValue({ sequence: '10' }),
        simulateTransaction: jest.fn().mockResolvedValue({ result: {} }),
        prepareTransaction: jest
          .fn()
          .mockRejectedValue(
            new ContractCallFailedException('direct prepare failure'),
          ),
      };
      const svc = makeService(
        server,
        makeConfig({ SYSTEM_SIGNER_SECRET: 'NOT_A_VALID_SECRET' }),
      );

      await expect(svc.submitAutoRelease(1n, VALID_ADDRESS, 0)).rejects.toThrow(
        'direct prepare failure',
      );
    });

    it('uses errorResultXdr / errorResult / fallback when sendTransaction returns ERROR', async () => {
      const baseServer = {
        getAccount: jest.fn().mockResolvedValue({ sequence: '10' }),
        simulateTransaction: jest.fn().mockResolvedValue({ result: {} }),
        prepareTransaction: jest.fn().mockImplementation((tx) => tx),
      };

      const svcWithXdr = makeService(
        {
          ...baseServer,
          sendTransaction: jest.fn().mockResolvedValue({
            status: 'ERROR',
            errorResultXdr: 'AAAA-error-xdr',
          }),
        },
        makeConfig(),
      );
      await expect(
        svcWithXdr.submitAutoRelease(1n, VALID_ADDRESS, 0),
      ).rejects.toThrow('Submission failed: AAAA-error-xdr');

      const svcWithObj = makeService(
        {
          ...baseServer,
          sendTransaction: jest.fn().mockResolvedValue({
            status: 'ERROR',
            errorResult: { code: 'tx_failed' },
          }),
        },
        makeConfig(),
      );
      await expect(
        svcWithObj.submitAutoRelease(1n, VALID_ADDRESS, 0),
      ).rejects.toThrow('Submission failed: {"code":"tx_failed"}');

      const svcWithNone = makeService(
        {
          ...baseServer,
          sendTransaction: jest.fn().mockResolvedValue({
            status: 'ERROR',
          }),
        },
        makeConfig(),
      );
      await expect(
        svcWithNone.submitAutoRelease(1n, VALID_ADDRESS, 0),
      ).rejects.toThrow(
        'Submission failed: Transaction submission returned ERROR status',
      );
    });
  });
});
