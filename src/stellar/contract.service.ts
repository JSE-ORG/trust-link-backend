import { Inject, Injectable, Optional } from '@nestjs/common';
import { ContractCallFailedException } from './contract-call-failed.exception';
import { STELLAR_SERVER } from './stellar.tokens';

interface StellarServer {
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

  async submitAutoRelease(escrowId: string, maxRetries = 2): Promise<string> {
    if (!this.server) {
      throw new ContractCallFailedException('Stellar server is not configured');
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const result = await this.server.submitTransaction({
          operation: 'autoRelease',
          escrowId,
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
