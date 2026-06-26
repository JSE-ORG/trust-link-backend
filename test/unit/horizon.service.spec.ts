/**
 * Unit tests for HorizonService.
 *
 * Suite 1 (issue #291): Verifies that the Horizon URL is read from an
 * injected config source instead of being hard-coded, with a testnet fallback.
 *
 * Suite 2 (issue #50): Verifies the pollConfirmation polling loop.
 */
import axios from 'axios';
import {
  DEFAULT_HORIZON_URL,
  HorizonService,
} from '../../src/stellar/horizon.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Suite 1: URL configuration (issue #291) ───────────────────────────────────

function makeService(url?: string): HorizonService {
  return new HorizonService(
    url !== undefined ? { getStellarHorizonUrl: () => url } : undefined,
  );
}

describe('HorizonService — URL configuration (issue #291)', () => {
  describe('getHorizonUrl()', () => {
    it('returns the URL provided by the config', () => {
      const svc = makeService('https://horizon.stellar.org');
      expect(svc.getHorizonUrl()).toBe('https://horizon.stellar.org');
    });

    it('falls back to the testnet URL when the config provides an empty string', () => {
      const svc = makeService('');
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
    });

    it('falls back to the testnet URL when no config is provided', () => {
      const originalEnv = process.env.STELLAR_HORIZON_URL;
      delete process.env.STELLAR_HORIZON_URL;
      const svc = makeService();
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
      process.env.STELLAR_HORIZON_URL = originalEnv;
    });

    it('does not hard-code the testnet URL — uses whatever the config provides', () => {
      const custom = 'https://my-horizon.example.com';
      const svc = makeService(custom);
      expect(svc.getHorizonUrl()).not.toBe(DEFAULT_HORIZON_URL);
      expect(svc.getHorizonUrl()).toBe(custom);
    });
  });
});

// ── Suite 2: pollConfirmation (issue #50) ─────────────────────────────────────

describe('HorizonService.pollConfirmation (issue #50)', () => {
  let service: HorizonService;

  beforeEach(() => {
    service = new HorizonService();
    mockedAxios.get.mockReset();
  });

  it('resolves when target confirmations are reached', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ status: 200, data: { confirmations: 1 } })
      .mockResolvedValueOnce({ status: 200, data: { confirmations: 2 } })
      .mockResolvedValueOnce({ status: 200, data: { confirmations: 3 } });

    const result = await service.pollConfirmation('tx-hash', 3, 1000);

    expect(result).toEqual({
      confirmed: true,
      confirmations: 3,
      hash: 'tx-hash',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });

  it('throws a timeout error when confirmations never reach the target', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { confirmations: 0 } });

    await expect(service.pollConfirmation('tx-hash', 2, 350)).rejects.toThrow(
      'Horizon confirmation timed out',
    );
    expect(mockedAxios.get).toHaveBeenCalled();
  });
});
