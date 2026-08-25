import axios, { AxiosInstance, AxiosError } from 'axios';
import { GiglTrackingResponse } from './gigl.types';

/**
 * Options for constructing a GiglClient.
 */
export interface GiglClientOptions {
  /** Base URL of the GIGL API, e.g. "https://api.gigl.com/v1" */
  baseUrl: string;
  /** Bearer token / API key issued by GIGL. */
  apiToken: string;
  /** Request timeout in milliseconds (default: 10 000). */
  timeoutMs?: number;
}

/**
 * Typed error thrown when the GIGL API rejects a request with a 401.
 */
export class GiglUnauthorizedError extends Error {
  constructor(trackingNumber: string) {
    super(
      `GIGL API rejected the request for tracking number "${trackingNumber}": ` +
        `invalid or expired API token (HTTP 401).`,
    );
    this.name = 'GiglUnauthorizedError';
  }
}

/**
 * Typed error thrown when the GIGL API cannot be reached (timeouts,
 * connection refused, DNS failures, etc.).
 */
export class GiglNetworkError extends Error {
  constructor(trackingNumber: string, cause: string) {
    super(
      `Network error while fetching GIGL tracking data for "${trackingNumber}": ${cause}`,
    );
    this.name = 'GiglNetworkError';
  }
}

/**
 * Typed error thrown when the GIGL API returns an unexpected HTTP error
 * (e.g. 500 Internal Server Error).
 */
export class GiglProviderError extends Error {
  readonly statusCode: number;

  constructor(trackingNumber: string, statusCode: number) {
    super(
      `GIGL API returned HTTP ${statusCode} for tracking number "${trackingNumber}".`,
    );
    this.name = 'GiglProviderError';
    this.statusCode = statusCode;
  }
}

/**
 * Typed error thrown when the GIGL API returns a 2xx response whose body
 * does not match the expected `GiglTrackingResponse` shape. Guard against
 * providers returning HTML error pages, truncated payloads, or success-with-
 * empty-body under a 200 status.
 */
export class GiglInvalidResponseError extends Error {
  constructor(trackingNumber: string, reason: string) {
    super(
      `GIGL API returned a malformed response for tracking number "${trackingNumber}": ${reason}`,
    );
    this.name = 'GiglInvalidResponseError';
  }
}

/**
 * Type guard that determines whether a value matches the
 * `GiglTrackingResponse` shape returned by `GET /tracking/{trackingNumber}`.
 *
 * Used to surface providers or upstreams that respond with 2xx and an
 * unexpected body (HTML error page, empty body, truncated JSON, etc.) as a
 * typed `GiglInvalidResponseError` rather than leaking the bad payload to
 * downstream consumers.
 */
function isValidGiglResponse(data: unknown): data is GiglTrackingResponse {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.tracking_number === 'string' &&
    typeof record.current_status === 'string' &&
    typeof record.carrier_code === 'string' &&
    (typeof record.estimated_delivery === 'string' ||
      record.estimated_delivery === null) &&
    Array.isArray(record.events)
  );
}

/**
 * Thin HTTP wrapper around the GIGL logistics tracking API.
 *
 * Responsible **only** for making the HTTP call and surfacing typed errors.
 * Response-to-domain mapping is handled by GiglLogisticsService.
 */
export class GiglClient {
  private readonly http: AxiosInstance;

  constructor(options: GiglClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs ?? 10_000,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetches the raw tracking payload from GIGL for a given tracking number.
   *
   * @throws {GiglUnauthorizedError} on HTTP 401
   * @throws {GiglNetworkError} on network-level failures (timeout, ECONNREFUSED, …)
   * @throws {GiglProviderError} on any other non-2xx HTTP response
   * @throws {GiglInvalidResponseError} when a 2xx response body does not match
   *   the expected tracking-payload schema
   */
  async fetchTracking(trackingNumber: string): Promise<GiglTrackingResponse> {
    try {
      const response = await this.http.get<GiglTrackingResponse>(
        `/tracking/${encodeURIComponent(trackingNumber)}`,
      );
      if (!isValidGiglResponse(response.data)) {
        throw new GiglInvalidResponseError(
          trackingNumber,
          'response body is missing one or more required fields',
        );
      }
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError;

        // No response received — network-level failure
        if (!axiosErr.response) {
          const cause =
            axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT'
              ? `request timed out (${axiosErr.code})`
              : (axiosErr.message ?? 'unknown network error');
          throw new GiglNetworkError(trackingNumber, cause);
        }

        const status = axiosErr.response.status;
        if (status === 401) {
          throw new GiglUnauthorizedError(trackingNumber);
        }

        throw new GiglProviderError(trackingNumber, status);
      }

      // Re-throw non-Axios errors verbatim
      throw err;
    }
  }
}
