/**
 * Unit tests for `GiglClient` — exercise every branch of the HTTP wrapper so
 * that error mapping is documented and protected against silent regressions.
 *
 * Acceptance criteria (issue #404):
 *  - axios.create is configured with base URL, bearer token and timeout.
 *  - Successful 2xx responses are returned as the typed tracking shape.
 *  - Network timeouts surface as `GiglNetworkError` (typed), not raw axios.
 *  - A 404 from the provider is surfaced distinctly from a 500.
 *  - A malformed response body is rejected rather than returned as-is.
 *  - No real network request is made.
 *
 * The implementation is the only real HTTP client in the logistics layer; the
 * error translation it does is the entire value of the class, so every code
 * path (`isAxiosError` true/false, `response` present/absent, timeout codes,
 * 401 vs 4xx/5xx, shape validation) must be exercised at least once.
 */

import axios, { AxiosInstance } from 'axios';
import {
  GiglClient,
  GiglInvalidResponseError,
  GiglNetworkError,
  GiglProviderError,
  GiglUnauthorizedError,
} from './gigl.client';
import { GiglTrackingResponse } from './gigl.types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Fixture & helper factories ────────────────────────────────────────────────

/**
 * Builds a plain object that mimics axios's own error shape so it satisfies
 * `axios.isAxiosError(err)` (which only checks
 * `isObject(payload) && payload.isAxiosError === true`).
 *
 * Using a plain object (rather than a real `Error` instance with
 * `Object.assign` overrides) keeps `message: null` testable — Error's
 * property descriptor for `message` coerces null assignments back to a
 * string in some engines, which would mask the `?? 'unknown network error'`
 * fallback branch the implementation depends on.
 */
function makeAxiosError(
  partial: {
    code?: string;
    message?: string | null;
    response?: { status: number; data?: unknown };
  } = {},
): object {
  return {
    isAxiosError: true,
    code: partial.code,
    message: partial.message,
    response: partial.response,
  };
}

function makeValidResponse(
  overrides: Partial<GiglTrackingResponse> = {},
): GiglTrackingResponse {
  return {
    tracking_number: 'TRK-001',
    current_status: 'IN_TRANSIT',
    carrier_code: 'GIGL-EXPRESS',
    estimated_delivery: '2024-04-01T18:00:00Z',
    events: [
      {
        event_time: '2024-03-30T08:00:00Z',
        event_code: 'PICKUP',
        location: 'Lagos Hub',
        description: 'Parcel picked up from sender.',
      },
    ],
    ...overrides,
  };
}

const DEFAULT_OPTS = {
  baseUrl: 'https://api.gigl.com/v1',
  apiToken: 'tok-test-123',
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('GiglClient', () => {
  let httpInstance: { get: jest.Mock };
  let client: GiglClient;

  beforeEach(() => {
    jest.clearAllMocks();
    httpInstance = { get: jest.fn() };
    mockedAxios.create.mockReturnValue(
      httpInstance as unknown as AxiosInstance,
    );
    // Match the real axios.isAxiosError contract: true iff the value is an
    // object carrying an explicit `isAxiosError: true` flag.
    mockedAxios.isAxiosError.mockImplementation((err: unknown): boolean =>
      Boolean(
        (err as { isAxiosError?: unknown } | null | undefined)?.isAxiosError ===
        true,
      ),
    );
    client = new GiglClient(DEFAULT_OPTS);
  });

  // ── Constructor: axios.create configuration ─────────────────────────────

  describe('constructor — axios.create configuration', () => {
    it('configures the axios instance with the supplied base URL, bearer token, content-type header, and the default 10s timeout', () => {
      expect(mockedAxios.create).toHaveBeenCalledTimes(1);
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://api.gigl.com/v1',
        timeout: 10_000,
        headers: {
          Authorization: 'Bearer tok-test-123',
          'Content-Type': 'application/json',
        },
      });
    });

    it('honors a custom timeoutMs', () => {
      jest.clearAllMocks();
      httpInstance = { get: jest.fn() };
      mockedAxios.create.mockReturnValue(
        httpInstance as unknown as AxiosInstance,
      );
      new GiglClient({ ...DEFAULT_OPTS, timeoutMs: 2_500 });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 2_500 }),
      );
    });

    it('embeds the configured bearer token in the Authorization header verbatim', () => {
      jest.clearAllMocks();
      httpInstance = { get: jest.fn() };
      mockedAxios.create.mockReturnValue(
        httpInstance as unknown as AxiosInstance,
      );
      new GiglClient({
        ...DEFAULT_OPTS,
        apiToken: 'a.b.c-with_special=chars',
      });

      const [createArg] = mockedAxios.create.mock.calls[0] ?? [];
      expect(createArg?.headers).toMatchObject({
        Authorization: 'Bearer a.b.c-with_special=chars',
      });
    });
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  describe('fetchTracking — happy path', () => {
    it('encodes the tracking number and returns response.data as the typed tracking payload', async () => {
      const payload = makeValidResponse();
      httpInstance.get.mockResolvedValue({ data: payload });

      const result = await client.fetchTracking('TRK 001/abc');

      expect(httpInstance.get).toHaveBeenCalledTimes(1);
      // encodeURIComponent('TRK 001/abc') === 'TRK%20001%2Fabc'
      expect(httpInstance.get).toHaveBeenCalledWith(
        '/tracking/TRK%20001%2Fabc',
      );
      expect(result).toEqual(payload);
    });

    it('returns the typed tracking shape on a 2xx response', async () => {
      const payload = makeValidResponse({
        tracking_number: 'TRK-002',
        current_status: 'DELIVERED',
        carrier_code: 'GIGL-PRIORITY',
        estimated_delivery: null,
      });
      httpInstance.get.mockResolvedValue({ data: payload });

      const result = await client.fetchTracking('TRK-002');

      expect(result).toMatchObject({
        tracking_number: 'TRK-002',
        current_status: 'DELIVERED',
        carrier_code: 'GIGL-PRIORITY',
        estimated_delivery: null,
        events: expect.any(Array),
      });
    });

    it('accepts a payload whose estimated_delivery is the literal null', async () => {
      const payload = makeValidResponse({ estimated_delivery: null });
      httpInstance.get.mockResolvedValue({ data: payload });

      const result = await client.fetchTracking('TRK-NULL-ETA');

      expect(result.estimated_delivery).toBeNull();
    });
  });

  // ── Network-level failures (no response received) ───────────────────────

  describe('fetchTracking — network-level failures', () => {
    it('maps ECONNABORTED (client-side request timeout) to GiglNetworkError mentioning the timeout code', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          code: 'ECONNABORTED',
          message: 'timeout of 10000ms exceeded',
        }),
      );

      await expect(client.fetchTracking('TRK-TIMEOUT')).rejects.toThrow(
        GiglNetworkError,
      );
      await expect(client.fetchTracking('TRK-TIMEOUT')).rejects.toThrow(
        /TRK-TIMEOUT/,
      );
      await expect(client.fetchTracking('TRK-TIMEOUT')).rejects.toThrow(
        /timed out \(ECONNABORTED\)/,
      );
    });

    it('maps ETIMEDOUT (socket-level timeout) to GiglNetworkError mentioning ETIMEDOUT', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          code: 'ETIMEDOUT',
          message: 'connect ETIMEDOUT',
        }),
      );

      await expect(client.fetchTracking('TRK-SOCK-T')).rejects.toThrow(
        GiglNetworkError,
      );
      await expect(client.fetchTracking('TRK-SOCK-T')).rejects.toThrow(
        /timed out \(ETIMEDOUT\)/,
      );
    });

    it('maps other network codes (e.g. ECONNREFUSED) using the underlying axiosErr.message as cause', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          code: 'ECONNREFUSED',
          message: 'connect ECONNREFUSED 127.0.0.1:443',
        }),
      );

      const thrown = (await client
        .fetchTracking('TRK-CONNREFUSED')
        .catch((e: unknown) => e)) as Error;

      expect(thrown).toBeInstanceOf(GiglNetworkError);
      expect(thrown.message).toMatch(/TRK-CONNREFUSED/);
      expect(thrown.message).toMatch(/connect ECONNREFUSED/);
      // NOT the timeout branch — cause is the underlying message, not the
      // synthetic "timed out (CODE)" string.
      expect(thrown.message).not.toMatch(/timed out/);
    });

    it('falls back to "unknown network error" when axiosErr.message is null', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({ code: 'ECONNRESET', message: null }),
      );

      const thrown = (await client
        .fetchTracking('TRK-NOMSG')
        .catch((e: unknown) => e)) as Error;

      expect(thrown).toBeInstanceOf(GiglNetworkError);
      expect(thrown.message).toMatch(/unknown network error/);
    });
  });

  // ── HTTP status code mapping ───────────────────────────────────────────

  describe('fetchTracking — HTTP error status', () => {
    it('maps HTTP 401 to GiglUnauthorizedError', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          response: { status: 401, data: { error: 'invalid_token' } },
        }),
      );

      await expect(client.fetchTracking('TRK-401')).rejects.toThrow(
        GiglUnauthorizedError,
      );
      await expect(client.fetchTracking('TRK-401')).rejects.toThrow(/TRK-401/);
      await expect(client.fetchTracking('TRK-401')).rejects.toThrow(
        /invalid or expired API token/i,
      );
    });

    it('maps HTTP 404 to GiglProviderError with statusCode 404', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          response: { status: 404, data: { error: 'not_found' } },
        }),
      );

      const thrown = (await client
        .fetchTracking('TRK-NOTFOUND')
        .catch((e: unknown) => e)) as GiglProviderError;

      expect(thrown).toBeInstanceOf(GiglProviderError);
      expect(thrown.name).toBe('GiglProviderError');
      expect(thrown.statusCode).toBe(404);
      expect(thrown.message).toMatch(/TRK-NOTFOUND/);
      expect(thrown.message).toMatch(/HTTP 404/);
    });

    it('maps HTTP 500 to GiglProviderError with statusCode 500 — distinct from 404', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          response: { status: 500, data: { error: 'server_error' } },
        }),
      );

      const thrown = (await client
        .fetchTracking('TRK-500')
        .catch((e: unknown) => e)) as GiglProviderError;

      expect(thrown).toBeInstanceOf(GiglProviderError);
      expect(thrown.statusCode).toBe(500);
      expect(thrown.statusCode).not.toBe(404); // distinct from the 404 branch
      expect(thrown.message).toMatch(/HTTP 500/);
    });

    it('maps HTTP 503 (Service Unavailable) to GiglProviderError with statusCode 503', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          response: { status: 503, data: { error: 'unavailable' } },
        }),
      );

      const thrown = (await client
        .fetchTracking('TRK-503')
        .catch((e: unknown) => e)) as GiglProviderError;

      expect(thrown).toBeInstanceOf(GiglProviderError);
      expect(thrown.statusCode).toBe(503);
      expect(thrown.message).toMatch(/HTTP 503/);
    });

    it('404 and 500 are surfaced distinctly on parallel calls', async () => {
      httpInstance.get.mockRejectedValueOnce(
        makeAxiosError({ response: { status: 404, data: {} } }),
      );
      const err404 = (await client
        .fetchTracking('TRK-A')
        .catch((e: unknown) => e)) as GiglProviderError;

      httpInstance.get.mockRejectedValueOnce(
        makeAxiosError({ response: { status: 500, data: {} } }),
      );
      const err500 = (await client
        .fetchTracking('TRK-B')
        .catch((e: unknown) => e)) as GiglProviderError;

      expect(err404.statusCode).toBe(404);
      expect(err500.statusCode).toBe(500);
      expect(err404.statusCode).not.toBe(err500.statusCode);
      expect(err404.message).toMatch(/TRK-A/);
      expect(err500.message).toMatch(/TRK-B/);
    });
  });

  // ── Malformed response bodies ──────────────────────────────────────────

  describe('fetchTracking — malformed response bodies', () => {
    it('rejects a null response body as GiglInvalidResponseError (not returned as-is)', async () => {
      httpInstance.get.mockResolvedValue({ data: null });

      await expect(client.fetchTracking('TRK-NULL-BODY')).rejects.toThrow(
        GiglInvalidResponseError,
      );
      await expect(client.fetchTracking('TRK-NULL-BODY')).rejects.toThrow(
        /TRK-NULL-BODY/,
      );
      await expect(client.fetchTracking('TRK-NULL-BODY')).rejects.toThrow(
        /malformed/i,
      );
    });

    it('rejects a response body that is missing one or more required fields', async () => {
      httpInstance.get.mockResolvedValue({
        // Missing current_status, carrier_code, estimated_delivery, events
        data: { tracking_number: 'TRK-PARTIAL' },
      });

      await expect(client.fetchTracking('TRK-PARTIAL')).rejects.toThrow(
        GiglInvalidResponseError,
      );
    });

    it('rejects a response body where a required field has the wrong type', async () => {
      httpInstance.get.mockResolvedValue({
        data: {
          tracking_number: 'TRK-WRONG-TYPE',
          current_status: 'IN_TRANSIT',
          carrier_code: 'GIGL-EXPRESS',
          estimated_delivery: 12345, // wrong: must be string | null
          events: [],
        },
      });

      await expect(client.fetchTracking('TRK-WRONG-TYPE')).rejects.toThrow(
        GiglInvalidResponseError,
      );
    });

    it('rejects when response.data is an array (non-object payload)', async () => {
      httpInstance.get.mockResolvedValue({
        data: [{ tracking_number: 'TRK-ARRAY' }],
      });

      await expect(client.fetchTracking('TRK-ARRAY')).rejects.toThrow(
        GiglInvalidResponseError,
      );
    });

    it('rejects when events field is missing (must be an array)', async () => {
      httpInstance.get.mockResolvedValue({
        data: {
          tracking_number: 'TRK-NO-EVENTS',
          current_status: 'IN_TRANSIT',
          carrier_code: 'GIGL-EXPRESS',
          estimated_delivery: null,
          // events: undefined (omitted)
        },
      });

      await expect(client.fetchTracking('TRK-NO-EVENTS')).rejects.toThrow(
        GiglInvalidResponseError,
      );
    });

    it('rejects when tracking_number or current_status is missing', async () => {
      httpInstance.get.mockResolvedValue({
        data: {
          // missing tracking_number
          current_status: 'IN_TRANSIT',
          carrier_code: 'GIGL-EXPRESS',
          estimated_delivery: null,
          events: [],
        },
      });

      await expect(client.fetchTracking('TRK-NO-TN')).rejects.toThrow(
        GiglInvalidResponseError,
      );
    });

    it('does NOT throw GiglInvalidResponseError on a fetch-time axios error (network errors must still be translated by the catch block)', async () => {
      httpInstance.get.mockRejectedValue(
        makeAxiosError({
          code: 'ECONNABORTED',
          message: 'timeout of 10000ms exceeded',
        }),
      );

      // The catch block must still translate axios errors into typed errors;
      // the shape-validation guard runs only on the success path.
      await expect(client.fetchTracking('TRK-RAW-ERR')).rejects.toThrow(
        GiglNetworkError,
      );
      const thrown = (await client
        .fetchTracking('TRK-RAW-ERR')
        .catch((e: unknown) => e)) as Error;
      expect(thrown).not.toBeInstanceOf(GiglInvalidResponseError);
    });
  });

  // ── Non-axios errors ───────────────────────────────────────────────────

  describe('fetchTracking — non-axios errors', () => {
    it('re-throws a non-axios Error instance verbatim, without translation', async () => {
      const original = new Error('plain JS error from a hook');
      httpInstance.get.mockRejectedValue(original);

      const thrown = await client
        .fetchTracking('TRK-PLAIN')
        .catch((e: unknown) => e);

      // Identity check — same instance surfaces at the caller.
      expect(thrown).toBe(original);
      // The original is NOT one of the typed errors.
      expect(thrown).not.toBeInstanceOf(GiglUnauthorizedError);
      expect(thrown).not.toBeInstanceOf(GiglNetworkError);
      expect(thrown).not.toBeInstanceOf(GiglProviderError);
      expect(thrown).not.toBeInstanceOf(GiglInvalidResponseError);
    });

    it('re-throws a non-Error thrown value verbatim', async () => {
      httpInstance.get.mockRejectedValue('not an Error instance');

      await expect(client.fetchTracking('TRK-STR')).rejects.toBe(
        'not an Error instance',
      );
    });
  });

  // ── Error class structural assertions (mirror service spec) ────────────

  describe('error class structure', () => {
    it('GiglUnauthorizedError has the right name and extends Error', () => {
      const err = new GiglUnauthorizedError('TRK-001');
      expect(err.name).toBe('GiglUnauthorizedError');
      expect(err).toBeInstanceOf(Error);
    });

    it('GiglNetworkError has the right name and extends Error', () => {
      const err = new GiglNetworkError('TRK-001', 'timeout');
      expect(err.name).toBe('GiglNetworkError');
      expect(err).toBeInstanceOf(Error);
    });

    it('GiglProviderError exposes its HTTP status code', () => {
      const err = new GiglProviderError('TRK-001', 502);
      expect(err.name).toBe('GiglProviderError');
      expect(err.statusCode).toBe(502);
      expect(err).toBeInstanceOf(Error);
    });

    it('GiglInvalidResponseError has the right name and extends Error', () => {
      const err = new GiglInvalidResponseError('TRK-001', 'missing field');
      expect(err.name).toBe('GiglInvalidResponseError');
      expect(err.message).toMatch(/missing field/);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
