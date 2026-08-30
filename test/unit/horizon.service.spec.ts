/**
 * Unit tests for HorizonService.
 *
 * Suite 1 (issue #291): Verifies that the Horizon URL is read from
 * ConfigService instead of being hard-coded, with a network-aware fallback.
 * Suite 2 (issue #50): Verifies the pollConfirmation polling loop.
 * Suite 3 (issue #562): Verifies checkHealth(), folded in from AppController's
 * previously ad-hoc, untestable checkHorizon.
 */
import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
  DEFAULT_HORIZON_URL,
  HEALTH_CHECK_TIMEOUT_MS,
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

    it('resolves the testnet URL from STELLAR_NETWORK when no override is set', () => {
      const svc = makeService({ STELLAR_NETWORK: 'TESTNET' });
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
    });

    it('ignores an unrecognised STELLAR_NETWORK rather than producing undefined', () => {
      // An unknown network misses the lookup table entirely; the third
      // fallback is what stops the service from building requests against
      // "undefined/transactions/...".
      const svc = makeService({ STELLAR_NETWORK: 'FUTURENET' });
      expect(svc.getHorizonUrl()).toBe(DEFAULT_HORIZON_URL);
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

// ── Suite 4: timeout and failure paths (issue #701) ──────────────────────────
//
// The suites above cover the happy paths and one generic rejection. What was
// left untested is everything that goes wrong on a slow or unhealthy Horizon:
// the AbortController firing, a non-200 that still carries a body, and the
// polling loop's error handling. Those are the paths that run during an
// actual outage, so they are the ones worth having tests for.
//
// Timers are faked so the real 150ms health-check timeout and the 100ms poll
// interval do not have to be waited out, and so the deadline arithmetic is
// exercised deterministically instead of racing the clock.

describe('HorizonService — timeout and failure paths (issue #701)', () => {
  let service: HorizonService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = makeService();
    mockedAxios.get.mockReset();
    fetchSpy = jest.spyOn(global, 'fetch');
    // Silence the service logger; these tests deliberately drive error paths.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('checkHealth() timeout', () => {
    it('aborts the request when Horizon does not answer within the timeout', async () => {
      // A Horizon that accepts the connection and then never replies. Without
      // the AbortController this hangs for as long as the platform's default
      // socket timeout, which is far longer than a readiness probe can wait.
      fetchSpy.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            (init as RequestInit).signal?.addEventListener('abort', () => {
              reject(new Error('The operation was aborted.'));
            });
          }),
      );

      const pending = service.checkHealth();
      await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
      const result = await pending;

      expect(result.status).toBe('down');
      expect(result.error).toContain('aborted');
    });

    it('passes an abort signal to fetch and clears the timer once the request settles', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

      const result = await service.checkHealth();

      expect(result).toEqual({ status: 'ok' });
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
      // The finally block must clear the timer. A leaked 150ms timer per probe
      // keeps the event loop alive and, in tests, leaks across suites.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('clears the timer even when the request fails', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.checkHealth();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('falls back to a generic message when the thrown value is not an Error', async () => {
      // fetch is not the only thing that can throw here, and a rejected
      // non-Error would otherwise surface as `undefined` in the probe output.
      fetchSpy.mockRejectedValue('socket hang up');

      const result = await service.checkHealth();

      expect(result).toEqual({
        status: 'down',
        error: 'Horizon connection failed',
      });
    });
  });

  describe('pollConfirmation() failure paths', () => {
    it('does not accept a non-200 response even when it carries enough confirmations', async () => {
      // A 202 or a 3xx is not a confirmed transaction. Reading the body
      // anyway would report a transaction as final off the back of a
      // redirect or an accepted-but-not-processed response.
      mockedAxios.get.mockResolvedValue({
        status: 202,
        data: { confirmations: 99 },
      });

      const pending = service.pollConfirmation('tx-hash', 3, 500);
      const assertion = expect(pending).rejects.toThrow(
        'Horizon confirmation timed out',
      );
      await jest.advanceTimersByTimeAsync(500);
      await assertion;
    });

    it('keeps retrying through request errors until the deadline', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ECONNRESET'));

      const pending = service.pollConfirmation('tx-hash', 1, 500);
      const assertion = expect(pending).rejects.toThrow(
        'Horizon confirmation timed out',
      );
      await jest.advanceTimersByTimeAsync(500);
      await assertion;

      // Retried rather than giving up on the first error: a single dropped
      // connection must not be reported as an unconfirmed transaction.
      expect(mockedAxios.get.mock.calls.length).toBeGreaterThan(1);
    });

    it('recovers when a transient error is followed by a good response', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue({ status: 200, data: { confirmations: 4 } });

      const pending = service.pollConfirmation('tx-hash', 3, 1000);
      await jest.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toEqual({
        confirmed: true,
        confirmations: 4,
        hash: 'tx-hash',
      });
    });

    it('breaks out of the loop when an error arrives after the deadline has passed', async () => {
      // The catch has its own deadline check, separate from the while
      // condition. Without it a request that fails slowly would sleep another
      // interval before the loop noticed it was already out of time.
      mockedAxios.get.mockImplementation(async () => {
        jest.advanceTimersByTime(1000);
        throw new Error('slow failure');
      });

      await expect(service.pollConfirmation('tx-hash', 3, 500)).rejects.toThrow(
        'Horizon confirmation timed out',
      );

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('treats a response with no confirmations field as zero confirmations', async () => {
      // Horizon omits the field rather than sending 0. `Number(undefined)` is
      // NaN, and NaN >= target is false, so an unguarded read would silently
      // never confirm instead of counting up from zero.
      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });

      await expect(
        service.pollConfirmation('tx-hash', 0, 500),
      ).resolves.toEqual({
        confirmed: true,
        confirmations: 0,
        hash: 'tx-hash',
      });
    });

    it('treats an entirely absent body as zero confirmations', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200, data: undefined });

      await expect(
        service.pollConfirmation('tx-hash', 0, 500),
      ).resolves.toEqual({
        confirmed: true,
        confirmations: 0,
        hash: 'tx-hash',
      });
    });

    it('uses the documented defaults when only a hash is given', async () => {
      // The defaults (3 confirmations, 10s) are the contract every caller that
      // omits them relies on, and nothing exercised them.
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { confirmations: 3 },
      });

      await expect(service.pollConfirmation('tx-hash')).resolves.toEqual({
        confirmed: true,
        confirmations: 3,
        hash: 'tx-hash',
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('url-encodes the transaction hash it looks up', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });

      await service.pollConfirmation('tx/../admin', 0, 500);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${service.getHorizonUrl()}/transactions/tx%2F..%2Fadmin`,
      );
    });
  });
});
