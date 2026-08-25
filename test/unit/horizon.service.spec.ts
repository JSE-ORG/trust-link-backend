/**
 * Unit tests for HorizonService.
 *
 * Suite 1 (issue #291): Verifies that the Horizon URL is read from
 * ConfigService instead of being hard-coded, with a network-aware fallback.
 * Suite 2 (issue #50): Verifies the pollConfirmation polling loop.
 * Suite 3 (issue #562): Verifies checkHealth(), folded in from AppController's
 * previously ad-hoc, untestable checkHorizon.
 */
import axios from 'axios';
import {
  DEFAULT_HORIZON_URL,
  HorizonService,
} from '../../src/stellar/horizon.service';
import { ConfigService } from '../../src/config/config.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfigService(
  values: Record<string, unknown> = {},
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeService(values: Record<string, unknown> = {}): HorizonService {
  return new HorizonService(makeConfigService(values));
}

// ── Suite 1: URL configuration (issue #291) ───────────────────────────────────

describe('HorizonService — URL configuration (issue #291)', () => {
  describe('getHorizonUrl()', () => {
    it('returns the URL provided by STELLAR_HORIZON_URL', () => {
      const svc = makeService({
        STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
        STELLAR_NETWORK: 'TESTNET',
      });
      expect(svc.getHorizonUrl()).toBe('https://horizon.stellar.org');
    });

    it('falls back to the mainnet URL when STELLAR_HORIZON_URL is unset and STELLAR_NETWORK is MAINNET', () => {
      const svc = makeService({ STELLAR_NETWORK: 'MAINNET' });
      expect(svc.getHorizonUrl()).toBe('https://horizon.stellar.org');
      expect(svc.getHorizonUrl()).not.toBe(DEFAULT_HORIZON_URL);
    });

    it('falls back to the testnet default when neither STELLAR_HORIZON_URL nor a recognised STELLAR_NETWORK is set', () => {
      const svc = makeService({});
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
    });

    it('does not hard-code the testnet URL — uses whatever STELLAR_HORIZON_URL provides', () => {
      const custom = 'https://my-horizon.example.com';
      const svc = makeService({ STELLAR_HORIZON_URL: custom });
      expect(svc.getHorizonUrl()).not.toBe(DEFAULT_HORIZON_URL);
      expect(svc.getHorizonUrl()).toBe(custom);
    });
  });
});

// ── Suite 2: pollConfirmation (issue #50) ─────────────────────────────────────

describe('HorizonService.pollConfirmation (issue #50)', () => {
  let service: HorizonService;

  beforeEach(() => {
    service = makeService();
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
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { confirmations: 0 },
    });

    await expect(service.pollConfirmation('tx-hash', 2, 350)).rejects.toThrow(
      'Horizon confirmation timed out',
    );
    expect(mockedAxios.get).toHaveBeenCalled();
  });
});

// ── Suite 3: checkHealth (issue #562) ──────────────────────────────────────────

describe('HorizonService.checkHealth (issue #562)', () => {
  let service: HorizonService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = makeService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns ok when Horizon responds with a 2xx status', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
    } as unknown as Response);

    const result = await service.checkHealth();

    expect(result).toEqual({ status: 'ok' });
    expect(fetchSpy).toHaveBeenCalledWith(
      service.getHorizonUrl(),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns down with the status when Horizon responds non-2xx', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 502,
    } as unknown as Response);

    const result = await service.checkHealth();

    expect(result).toEqual({
      status: 'down',
      error: 'Horizon returned status 502',
    });
  });

  it('returns down with the error message when the fetch rejects (e.g. timeout/network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('network timeout'));

    const result = await service.checkHealth();

    expect(result).toEqual({ status: 'down', error: 'network timeout' });
  });
});
