import { Test } from '@nestjs/testing';
import { ContractCallFailedException } from '../../src/stellar/contract-call-failed.exception';
import { ContractService } from '../../src/stellar/contract.service';
import { STELLAR_SERVER } from '../../src/stellar/stellar.tokens';

const ESCROW = 42n;
const ADMIN = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SOURCE = 'GAGRQY3NU3KFQMBABDJBSJKMT6LSTC2RXAYSAMSYB3Y6XUZRHI3ZGR7T';

describe('ContractService.submitAutoRelease (issue #19)', () => {
  let service: ContractService;
  let server: { loadAccount: jest.Mock; submitTransaction: jest.Mock };

  beforeEach(async () => {
    server = {
      loadAccount: jest.fn().mockResolvedValue({ sequence: '100' }),
      submitTransaction: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContractService,
        { provide: STELLAR_SERVER, useValue: server },
      ],
    }).compile();

    service = moduleRef.get(ContractService);
  });

  it('returns the hash after successful submission', async () => {
    server.submitTransaction.mockResolvedValue({ hash: 'tx-hash' });

    await expect(service.submitAutoRelease(ESCROW, SOURCE)).resolves.toBe(
      'tx-hash',
    );
  });

  it('throws ContractCallFailedException for TxFailed results', async () => {
    server.submitTransaction.mockResolvedValue({ resultXdr: 'TxFailed' });

    await expect(service.submitAutoRelease(ESCROW, SOURCE)).rejects.toThrow(
      ContractCallFailedException,
    );
  });

  it('retries sequence number errors', async () => {
    server.submitTransaction
      .mockRejectedValueOnce(new Error('bad sequence number'))
      .mockResolvedValueOnce({ hash: 'retry-hash' });

    await expect(service.submitAutoRelease(ESCROW, SOURCE)).resolves.toBe(
      'retry-hash',
    );
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it('throws when max retries are exceeded', async () => {
    server.submitTransaction.mockRejectedValue(new Error('sequence mismatch'));

    await expect(service.submitAutoRelease(ESCROW, SOURCE, 1)).rejects.toThrow(
      'Max retries exceeded',
    );
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  // ── #207: fresh sequence on each retry ──────────────────────────────────

  it('calls loadAccount before every attempt so the sequence is never stale', async () => {
    server.loadAccount
      .mockResolvedValueOnce({ sequence: '1' })
      .mockResolvedValueOnce({ sequence: '2' });
    server.submitTransaction
      .mockRejectedValueOnce(new Error('sequence error'))
      .mockResolvedValueOnce({ hash: 'fresh-hash' });

    const hash = await service.submitAutoRelease(ESCROW, SOURCE, 1);

    expect(hash).toBe('fresh-hash');
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
    expect(server.submitTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sequence: '1' }),
    );
    expect(server.submitTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sequence: '2' }),
    );
  });

  it('includes sourceAddress and sequence in the submitted transaction', async () => {
    server.loadAccount.mockResolvedValue({ sequence: '42' });
    server.submitTransaction.mockResolvedValue({ hash: 'tx-ok' });

    await service.submitAutoRelease(ESCROW, SOURCE);

    expect(server.submitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'autoRelease',
        contractEscrowId: '42',
        sourceAddress: SOURCE,
        sequence: '42',
      }),
    );
  });

  it('records delivery with a contract transaction', async () => {
    server.submitTransaction.mockResolvedValue({ hash: 'delivery-hash' });

    await expect(service.recordDelivery(ESCROW, ADMIN)).resolves.toBe(
      'delivery-hash',
    );
    expect(server.submitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'recordDelivery',
        contractEscrowId: '42',
      }),
    );
  });
});
