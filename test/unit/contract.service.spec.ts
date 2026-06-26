import { Test } from '@nestjs/testing';
import { ContractCallFailedException } from '../../src/stellar/contract-call-failed.exception';
import { ContractService } from '../../src/stellar/contract.service';
import { STELLAR_SERVER } from '../../src/stellar/stellar.tokens';

describe('ContractService.submitAutoRelease (issue #19)', () => {
  let service: ContractService;
  let server: { submitTransaction: jest.Mock };

  beforeEach(async () => {
    server = { submitTransaction: jest.fn() };
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

    await expect(service.submitAutoRelease('escrow-1')).resolves.toBe(
      'tx-hash',
    );
  });

  it('throws ContractCallFailedException for TxFailed results', async () => {
    server.submitTransaction.mockResolvedValue({ resultXdr: 'TxFailed' });

    await expect(service.submitAutoRelease('escrow-1')).rejects.toThrow(
      ContractCallFailedException,
    );
  });

  it('retries sequence number errors', async () => {
    server.submitTransaction
      .mockRejectedValueOnce(new Error('bad sequence number'))
      .mockResolvedValueOnce({ hash: 'retry-hash' });

    await expect(service.submitAutoRelease('escrow-1')).resolves.toBe(
      'retry-hash',
    );
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it('throws when max retries are exceeded', async () => {
    server.submitTransaction.mockRejectedValue(new Error('sequence mismatch'));

    await expect(service.submitAutoRelease('escrow-1', 1)).rejects.toThrow(
      'Max retries exceeded',
    );
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it('records delivery with a contract transaction', async () => {
    server.submitTransaction.mockResolvedValue({ hash: 'delivery-hash' });

    await expect(service.recordDelivery('escrow-2')).resolves.toBe(
      'delivery-hash',
    );
    expect(server.submitTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'recordDelivery',
        escrowId: 'escrow-2',
      }),
    );
  });
});
