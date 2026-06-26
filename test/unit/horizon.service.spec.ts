/**
 * Unit tests for HorizonService (issue #291).
 * Verifies that the Horizon URL is read from ConfigService instead
 * of being hard-coded, and falls back to the testnet default.
 */
import {
  DEFAULT_HORIZON_URL,
  HorizonService,
} from '../../src/stellar/horizon.service';

function makeService(url?: string): HorizonService {
  return new HorizonService({
    getStellarHorizonUrl: () => url ?? '',
  });
}

describe('HorizonService (issue #291)', () => {
  describe('getHorizonUrl()', () => {
    it('returns the URL provided by the config', () => {
      const svc = makeService('https://horizon.stellar.org');
      expect(svc.getHorizonUrl()).toBe('https://horizon.stellar.org');
    });

    it('falls back to the testnet URL when the config provides an empty string', () => {
      const svc = makeService('');
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
    });

    it('falls back to the testnet URL when the config is not provided', () => {
      const svc = makeService();
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
    });

    it('does not hard-code the testnet URL — uses whatever the config provides', () => {
      const custom = 'https://my-horizon.example.com';
      const svc = makeService(custom);
      expect(svc.getHorizonUrl()).not.toBe(DEFAULT_HORIZON_URL);
      expect(svc.getHorizonUrl()).toBe(custom);
    });
  });

  describe('getTransaction()', () => {
    const TX_HASH = 'abc123def456';

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns the transaction object on a 200 response', async () => {
      const txData = { id: TX_HASH, paging_token: '1' };
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(txData),
      } as Response);

      const svc = makeService('https://horizon-testnet.stellar.org');
      const result = await svc.getTransaction(TX_HASH);
      expect(result).toEqual(txData);
    });

    it('returns null for a 404 response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const svc = makeService('https://horizon-testnet.stellar.org');
      const result = await svc.getTransaction(TX_HASH);
      expect(result).toBeNull();
    });

    it('throws an error for a non-404 error response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const svc = makeService('https://horizon-testnet.stellar.org');
      await expect(svc.getTransaction(TX_HASH)).rejects.toThrow('503');
    });

    it('calls the correct Horizon URL', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);

      const horizonBase = 'https://custom-horizon.example.com';
      const svc = makeService(horizonBase);
      await svc.getTransaction(TX_HASH);

      expect(fetchSpy).toHaveBeenCalledWith(
        `${horizonBase}/transactions/${TX_HASH}`,
      );
    });
  });
});
