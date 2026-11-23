import { DlqCleanupService } from './dlq-cleanup.service';
import { FailedTransactionRepository } from './failed-transaction.repository';
import { ConfigService } from '../config/config.service';

describe('DlqCleanupService', () => {
  it('prunes resolved DLQ rows using the configured retention cutoff', async () => {
    const repository = {
      pruneResolvedOlderThan: jest.fn().mockResolvedValue({ count: 3 }),
    } as unknown as FailedTransactionRepository;
    const config = {
      get: jest.fn().mockReturnValue(90),
    } as unknown as ConfigService;
    const service = new DlqCleanupService(repository, config);
    const now = Date.now();
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

    try {
      await service.pruneResolvedFailedTransactions();

      expect(config.get).toHaveBeenCalledWith('DLQ_RETENTION_DAYS');
      expect(repository.pruneResolvedOlderThan).toHaveBeenCalledWith(
        new Date(now - 90 * 24 * 60 * 60 * 1000),
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
