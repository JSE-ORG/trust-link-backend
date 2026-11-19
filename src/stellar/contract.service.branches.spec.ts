/**
 * Tests for ContractService error-decoding and low-level branches (issue #1125).
 *
 * Covers: decodeSimulationError (×2), decodeTransactionError, isSequenceError,
 * simulateTransaction, submitTransaction, getEscrowStateInternal.
 */

import { ContractCallFailedException } from '../stellar/contract.service';
import { ContractService } from '../stellar/contract.service';

function makeService(server?: object, config?: object): ContractService {
  return new ContractService(server as never, config as never, undefined);
}

// ── isSequenceError ───────────────────────────────────────────────────────────

describe('ContractService.isSequenceError', () => {
  let svc: ContractService;
  beforeEach(() => { svc = makeService(); });

  it('returns true for a string containing "sequence"', () => {
    expect((svc as never)['isSequenceError']('bad sequence error')).toBe(true);
  });

  it('returns true for a string containing "tx_bad_seq"', () => {
    expect((svc as never)['isSequenceError']('TX_BAD_SEQ')).toBe(true);
  });

  it('returns false for an unrelated string', () => {
    expect((svc as never)['isSequenceError']('timeout error')).toBe(false);
  });

  it('returns true for an Error with sequence in message', () => {
    expect((svc as never)['isSequenceError'](new Error('tx_bad_seq'))).toBe(true);
  });

  it('returns false for an Error without sequence', () => {
    expect((svc as never)['isSequenceError'](new Error('connection reset'))).toBe(false);
  });

  it('returns false for a non-string non-Error value', () => {
    expect((svc as never)['isSequenceError'](42)).toBe(false);
  });
});

// ── decodeSimulationError ─────────────────────────────────────────────────────

describe('ContractService.decodeSimulationError', () => {
  let svc: ContractService;
  beforeEach(() => { svc = makeService(); });

  it('returns the error field when simResult has an error', () => {
    const simResult = { error: 'contract panic' };
    const result = (svc as never)['decodeSimulationError'](simResult);
    expect(result).toBe('contract panic');
  });

  it('returns "Unknown simulation error" when error field is absent', () => {
    const simResult = {};
    const result = (svc as never)['decodeSimulationError'](simResult);
    expect(result).toBe('Unknown simulation error');
  });
});

// ── decodeTransactionError ────────────────────────────────────────────────────

describe('ContractService.decodeTransactionError', () => {
  let svc: ContractService;
  beforeEach(() => { svc = makeService(); });

  it('returns resultXdr string when present', () => {
    const txResponse = { resultXdr: 'AAAAAQAAAAAAAAAAAAAAAgAAAAIAAAAA' };
    expect((svc as never)['decodeTransactionError'](txResponse)).toBe(
      'AAAAAQAAAAAAAAAAAAAAAgAAAAIAAAAA',
    );
  });

  it('returns "Transaction failed on chain" when resultXdr is absent', () => {
    expect((svc as never)['decodeTransactionError']({})).toBe(
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
      (svc as never)['simulateTransaction']({} as never, 'fn'),
    ).rejects.toThrow(ContractCallFailedException);
  });

  it('calls server.simulateTransaction when available', async () => {
    const simResult = { result: {} };
    const server = { simulateTransaction: jest.fn().mockResolvedValue(simResult) };
    const svc = makeService(server);
    const result = await (svc as never)['simulateTransaction']({} as never, 'fn');
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
      (svc as never)['submitTransaction']({} as never, 'fn'),
    ).rejects.toThrow(ContractCallFailedException);
  });

  it('calls server.sendTransaction when available', async () => {
    const sendResult = { status: 'PENDING', hash: 'abc' };
    const server = { sendTransaction: jest.fn().mockResolvedValue(sendResult) };
    const svc = makeService(server);
    const result = await (svc as never)['submitTransaction']({} as never, 'fn');
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
});
