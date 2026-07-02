import { Inject, Injectable, Optional } from '@nestjs/common';
import { ContractCallFailedException } from './contract-call-failed.exception';
import { STELLAR_SERVER } from './stellar.tokens';
import { DEFAULT_AUTO_RELEASE_MAX_RETRIES } from './contract.constants';

interface StellarServer {
  /** Loads the current account state (including sequence number) from Horizon. */
  loadAccount(sourceAddress: string): Promise<{ sequence: string }>;
  submitTransaction(transaction: Record<string, unknown>): Promise<{
    hash?: string;
    status?: string;
    resultXdr?: string;
  }>;
}

@Injectable()
export class ContractService {
  constructor(
    @Optional()
    @Inject(STELLAR_SERVER)
    private readonly server?: StellarServer,
  ) {}

  /** Submits the on-chain dispute resolution transaction and returns its hash. */
  async resolveDispute(
    escrowId: string,
    resolution: 'RELEASE' | 'REFUND',
  ): Promise<string> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }
    const result = await this.server.submitTransaction({
      operation: 'resolveDispute',
      escrowId,
      resolution,
    });
    if (result.status === 'ERROR' || result.resultXdr === 'TxFailed') {
      throw new ContractCallFailedException();
    }
    if (!result.hash) {
      throw new ContractCallFailedException('Missing transaction hash');
    }
    return result.hash;
  }

  /**
   * Submits an auto-release transaction, retrying on Stellar sequence errors.
   *
   * On each attempt the source account is re-fetched from Horizon so the
   * transaction is rebuilt with the current sequence number — a stale sequence
   * embedded in the XDR is the root cause of every retry failure on tx_bad_seq.
   *
   * @param escrowId      Trust-Link escrow identifier embedded in the contract call.
   * @param sourceAddress Stellar address of the auto-release signing account.
   * @param maxRetries    Maximum number of additional attempts after the first failure.
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
      // Re-fetch the account before every attempt so the transaction is built
      // with the current sequence number. Without this, a sequence error on
      // attempt N causes attempt N+1 to replay the same stale XDR and fail again.
      const account = await this.server.loadAccount(sourceAddress);

      try {
        const result = await this.server.submitTransaction({
          operation: 'autoRelease',
          escrowId,
          sourceAddress,
          sequence: account.sequence,
        });

        if (result.status === 'ERROR' || result.resultXdr === 'TxFailed') {
          throw new ContractCallFailedException();
        }

        if (!result.hash) {
          throw new ContractCallFailedException('Missing transaction hash');
        }

        return result.hash;
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

  /** Submits an on-chain cancellation/refund transaction and returns the transaction hash. */
  async cancelEscrowOnChain(escrowId: string): Promise<string> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }
    const result = await this.server.submitTransaction({
      operation: 'cancelEscrow',
      escrowId,
      refund: true,
    });
    if (result.status === 'ERROR' || result.resultXdr === 'TxFailed') {
      throw new ContractCallFailedException();
    }
    if (!result.hash) {
      throw new ContractCallFailedException('Missing transaction hash');
    }
    return result.hash;
  }

  /** Records delivery on-chain and returns the submitted transaction hash. */
  async recordDelivery(escrowId: string): Promise<string> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }

    const result = await this.server.submitTransaction({
      operation: 'recordDelivery',
      escrowId,
    });

    if (result.status === 'ERROR' || result.resultXdr === 'TxFailed') {
      throw new ContractCallFailedException();
    }

    if (!result.hash) {
      throw new ContractCallFailedException('Missing transaction hash');
    }

    return result.hash;
  }

  private isSequenceError(error: unknown): boolean {
    return (
      error instanceof Error && error.message.toLowerCase().includes('sequence')
    );
  }
}
