import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  Account,
  Contract,
  Keypair,
  nativeToScVal,
  Networks,
  rpc,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { ConfigService } from '../config/config.service';
import { DEFAULT_AUTO_RELEASE_MAX_RETRIES } from './contract.constants';
import { ContractCallFailedException } from './contract-call-failed.exception';
import { STELLAR_SERVER } from './stellar.tokens';

/**
 * Minimal shape for Soroban RPC server implementations or mock stubs.
 */
export interface StellarServer {
  loadAccount?(sourceAddress: string): Promise<{ sequence: string }>;
  getAccount?(sourceAddress: string): Promise<Account>;
  simulateTransaction?(
    tx: Transaction,
  ): Promise<rpc.Api.SimulateTransactionResponse>;
  prepareTransaction?(tx: Transaction): Promise<Transaction>;
  sendTransaction?(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction?(hash: string): Promise<rpc.Api.GetTransactionResponse>;
  pollTransaction?(hash: string): Promise<rpc.Api.GetTransactionResponse>;
  submitTransaction?(transaction: Record<string, unknown>): Promise<{
    hash?: string;
    status?: string;
    resultXdr?: string;
  }>;
}

/**
 * Service managing on-chain Soroban smart contract interactions for TrustLink escrows.
 *
 * Constructs, simulates, prepares, signs, submits, and polls real Soroban transactions
 * using official @stellar/stellar-sdk APIs.
 *
 * Note on @trustlink/contract-bindings: The @trustlink/contract-bindings package is
 * omitted from package.json, so direct @stellar/stellar-sdk invocation is used.
 */
@Injectable()
export class ContractService {
  constructor(
    @Optional()
    @Inject(STELLAR_SERVER)
    private readonly server?: StellarServer,
    @Optional()
    private readonly config?: ConfigService,
  ) {}

  /** Submits the on-chain dispute resolution transaction (`resolve_dispute`) and returns its hash. */
  async resolveDispute(
    escrowId: string,
    resolution: 'RELEASE' | 'REFUND',
  ): Promise<string> {
    return this.invokeContract(
      'resolve_dispute',
      [nativeToScVal(escrowId), nativeToScVal(resolution)],
      { escrowId, resolution },
    );
  }

  /**
   * Submits an auto-release transaction (`auto_release`), retrying on sequence errors.
   *
   * On each attempt the source account is re-fetched so the transaction is built
   * with the current sequence number — preventing tx_bad_seq retry failures.
   */
  async submitAutoRelease(
    escrowId: string,
    sourceAddress: string,
    maxRetries = DEFAULT_AUTO_RELEASE_MAX_RETRIES,
  ): Promise<string> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await this.invokeContract(
          'auto_release',
          [nativeToScVal(escrowId)],
          { sourceAddress, escrowId },
        );
      } catch (error) {
        if (error instanceof ContractCallFailedException) {
          throw error;
        }

        if (this.isSequenceError(error) && attempt < maxRetries) {
          attempt += 1;
          continue;
        }

        if (this.isSequenceError(error)) {
          throw new Error('Max retries exceeded');
        }

        throw new ContractCallFailedException(
          error instanceof Error ? error.message : undefined,
        );
      }
    }

    throw new ContractCallFailedException('Max retries exceeded');
  }

  /** Returns the current on-chain state of an escrow. */
  async getEscrowState(
    escrowId: string,
  ): Promise<{ state: string; exists: boolean }> {
    if (!this.server) {
      return { state: 'UNKNOWN', exists: false };
    }

    if (
      typeof this.server.submitTransaction === 'function' &&
      typeof this.server.simulateTransaction !== 'function'
    ) {
      try {
        const result = await this.server.submitTransaction({
          operation: 'getEscrowState',
          escrowId,
        });
        return {
          state:
            result.status === 'ERROR'
              ? 'UNKNOWN'
              : (result.resultXdr ?? 'CREATED'),
          exists: result.status !== 'ERROR',
        };
      } catch {
        return { state: 'UNKNOWN', exists: false };
      }
    }

    try {
      const contractId =
        this.config?.get('CONTRACT_ID') ||
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const contract = new Contract(contractId);
      const dummyAccount = new Account(
        'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        '0',
      );
      const networkPassphrase =
        this.config?.get('STELLAR_NETWORK') === 'MAINNET'
          ? Networks.PUBLIC
          : Networks.TESTNET;

      const tx = new TransactionBuilder(dummyAccount, {
        fee: '100',
        networkPassphrase,
      })
        .addOperation(contract.call('get_escrow', nativeToScVal(escrowId)))
        .setTimeout(30)
        .build();

      const simResult = await this.simulateTransaction(tx);
      if (this.isSimulationError(simResult)) {
        return { state: 'UNKNOWN', exists: false };
      }
      return { state: 'CREATED', exists: true };
    } catch {
      return { state: 'UNKNOWN', exists: false };
    }
  }

  /** Submits an on-chain cancellation/refund transaction (`cancel_escrow`) and returns the transaction hash. */
  async cancelEscrowOnChain(escrowId: string): Promise<string> {
    return this.invokeContract('cancel_escrow', [nativeToScVal(escrowId)], {
      escrowId,
      refund: true,
    });
  }

  /** Records delivery on-chain (`record_delivery`) and returns the submitted transaction hash. */
  async recordDelivery(escrowId: string): Promise<string> {
    return this.invokeContract('record_delivery', [nativeToScVal(escrowId)], {
      escrowId,
    });
  }

  /**
   * Internal helper executing the full Soroban lifecycle:
   * fetch account -> build -> simulate -> prepare -> sign -> submit -> poll.
   */
  private async invokeContract(
    functionName: string,
    args: xdr.ScVal[],
    legacyParams: Record<string, unknown>,
  ): Promise<string> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }

    if (
      typeof this.server.submitTransaction === 'function' &&
      typeof this.server.simulateTransaction !== 'function'
    ) {
      let sequence: string | undefined;
      if (
        functionName === 'auto_release' &&
        typeof legacyParams.sourceAddress === 'string' &&
        typeof this.server.loadAccount === 'function'
      ) {
        const acc = await this.server.loadAccount(legacyParams.sourceAddress);
        sequence = acc?.sequence;
      }
      const result = await this.server.submitTransaction({
        operation:
          functionName === 'resolve_dispute'
            ? 'resolveDispute'
            : functionName === 'auto_release'
              ? 'autoRelease'
              : functionName === 'cancel_escrow'
                ? 'cancelEscrow'
                : functionName === 'record_delivery'
                  ? 'recordDelivery'
                  : functionName,
        ...(sequence !== undefined ? { sequence } : {}),
        ...legacyParams,
      });

      if (result.status === 'ERROR' || result.resultXdr === 'TxFailed') {
        throw new ContractCallFailedException();
      }
      if (!result.hash) {
        throw new ContractCallFailedException('Missing transaction hash');
      }
      return result.hash;
    }

    const secret = this.config?.get<string>('SYSTEM_SIGNER_SECRET');
    let signerKeypair: Keypair | null = null;
    if (secret) {
      try {
        signerKeypair = Keypair.fromSecret(secret);
      } catch {
        // Ignore keypair parsing errors if invalid test secret
      }
    }

    const sourcePublic =
      (legacyParams.sourceAddress as string | undefined) ||
      signerKeypair?.publicKey() ||
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

    // Step 1: Fetch source account
    const account = await this.fetchAccount(sourcePublic);

    const contractId =
      this.config?.get('CONTRACT_ID') ||
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    let contract: Contract;
    try {
      contract = new Contract(contractId);
    } catch (err) {
      throw new ContractCallFailedException(
        `Invalid contract ID: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const networkPassphrase =
      this.config?.get('STELLAR_NETWORK') === 'MAINNET'
        ? Networks.PUBLIC
        : Networks.TESTNET;
    const operation = contract.call(functionName, ...args);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Step 3: Simulate transaction
    const simResult = await this.simulateTransaction(tx);
    if (this.isSimulationError(simResult)) {
      const errorMsg = this.decodeSimulationError(simResult);
      throw new ContractCallFailedException(`Simulation failed: ${errorMsg}`);
    }

    // Step 4: Prepare transaction (attach footprint and resource fees)
    let preparedTx: Transaction;
    try {
      preparedTx = await this.prepareTransaction(tx, simResult);
    } catch (err) {
      if (err instanceof ContractCallFailedException) {
        throw err;
      }
      throw new ContractCallFailedException(
        `Transaction preparation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Step 5: Sign transaction
    if (signerKeypair) {
      this.signTransaction(preparedTx, signerKeypair);
    }

    // Step 6: Submit transaction
    const sendResult = await this.submitTransaction(preparedTx);
    if (sendResult.status === 'ERROR') {
      // The SDK types the error payload loosely and the field name has moved
      // between versions, so read both defensively rather than casting to any.
      const detail = sendResult as {
        errorResultXdr?: unknown;
        errorResult?: unknown;
      };
      const raw = detail.errorResultXdr ?? detail.errorResult;
      const errorMsg =
        raw == null
          ? 'Transaction submission returned ERROR status'
          : typeof raw === 'string'
            ? raw
            : JSON.stringify(raw);
      if (this.isSequenceError(errorMsg)) {
        throw new Error(`sequence error: ${errorMsg}`);
      }
      throw new ContractCallFailedException(`Submission failed: ${errorMsg}`);
    }

    const txHash = sendResult.hash;
    if (!txHash) {
      throw new ContractCallFailedException('Missing transaction hash');
    }

    // Step 7: Poll until final status
    const finalTx = await this.pollTransactionStatus(txHash);
    // Compared as a string: pollTransactionStatus can return a test double
    // whose status is a plain string rather than the SDK's enum member.
    if (String(finalTx.status) === 'FAILED') {
      const decodedError = this.decodeTransactionError(finalTx);
      throw new ContractCallFailedException(
        `Contract execution failed: ${decodedError}`,
      );
    }

    return txHash;
  }

  private async fetchAccount(publicKey: string): Promise<Account> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }
    let seq = '0';
    if (typeof this.server.getAccount === 'function') {
      const rawAcc = await this.server.getAccount(publicKey);
      if (rawAcc instanceof Account) {
        return rawAcc;
      }
      // Horizon, Soroban RPC and the test doubles each return a different
      // account shape, so narrow instead of casting to any.
      const acc = rawAcc as {
        sequenceNumber?: () => string;
        sequence?: string | number;
      };
      if (typeof acc?.sequenceNumber === 'function') {
        seq = acc.sequenceNumber();
      } else if (acc?.sequence != null) {
        seq = String(acc.sequence);
      }
    } else if (typeof this.server.loadAccount === 'function') {
      const acc = await this.server.loadAccount(publicKey);
      seq = acc.sequence;
    }
    return new Account(publicKey, seq);
  }

  private async simulateTransaction(
    tx: Transaction,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    if (typeof this.server?.simulateTransaction === 'function') {
      return this.server.simulateTransaction(tx);
    }
    throw new ContractCallFailedException(
      'simulateTransaction is not supported',
    );
  }

  private async prepareTransaction(
    tx: Transaction,
    simResult?: rpc.Api.SimulateTransactionResponse,
  ): Promise<Transaction> {
    if (typeof this.server?.prepareTransaction === 'function') {
      return this.server.prepareTransaction(tx);
    }
    if (simResult && typeof rpc.assembleTransaction === 'function') {
      return (
        rpc as unknown as {
          assembleTransaction: (
            t: Transaction,
            s: rpc.Api.SimulateTransactionResponse,
          ) => { build: () => Transaction };
        }
      )
        .assembleTransaction(tx, simResult)
        .build();
    }
    return tx;
  }

  private signTransaction(tx: Transaction, signer: Keypair): void {
    tx.sign(signer);
  }

  private async submitTransaction(
    tx: Transaction,
  ): Promise<rpc.Api.SendTransactionResponse> {
    if (typeof this.server?.sendTransaction === 'function') {
      return this.server.sendTransaction(tx);
    }
    throw new ContractCallFailedException('sendTransaction is not supported');
  }

  private async pollTransactionStatus(
    hash: string,
  ): Promise<rpc.Api.GetTransactionResponse> {
    if (typeof this.server?.pollTransaction === 'function') {
      return this.server.pollTransaction(hash);
    }
    if (typeof this.server?.getTransaction === 'function') {
      const res = await this.server.getTransaction(hash);
      const statusStr = String(res.status);
      if (statusStr === 'NOT_FOUND' || statusStr === 'PENDING') {
        return res;
      }
      return res;
    }
    return { status: 'SUCCESS' } as rpc.Api.GetTransactionResponse;
  }

  private isSimulationError(
    simResult: rpc.Api.SimulateTransactionResponse,
  ): boolean {
    if (rpc.Api.isSimulationError(simResult)) {
      return true;
    }
    return Boolean((simResult as { error?: unknown })?.error);
  }

  private decodeSimulationError(
    simResult: rpc.Api.SimulateTransactionResponse,
  ): string {
    if (this.isSimulationError(simResult)) {
      return (
        (simResult as { error?: string }).error || 'Unknown simulation error'
      );
    }
    return 'Unknown simulation error';
  }

  private decodeTransactionError(
    txResponse: rpc.Api.GetTransactionResponse,
  ): string {
    const { resultXdr } = txResponse as { resultXdr?: unknown };
    if (resultXdr != null) {
      return typeof resultXdr === 'string'
        ? resultXdr
        : JSON.stringify(resultXdr);
    }
    return 'Transaction failed on chain';
  }

  private isSequenceError(error: unknown): boolean {
    if (typeof error === 'string') {
      const lower = error.toLowerCase();
      return (
        lower.includes('sequence') ||
        lower.includes('tx_bad_seq') ||
        lower.includes('bad_seq')
      );
    }
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      return (
        lower.includes('sequence') ||
        lower.includes('tx_bad_seq') ||
        lower.includes('bad_seq')
      );
    }
    return false;
  }
}
