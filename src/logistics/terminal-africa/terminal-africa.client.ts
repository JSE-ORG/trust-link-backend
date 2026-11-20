import axios, { AxiosInstance } from 'axios';
import {
  TerminalAfricaTrackingData,
  TerminalAfricaTrackingResponse,
} from './terminal-africa.types';

export interface TerminalAfricaClientOptions {
  /** e.g. "https://api.terminal.africa/v1" */
  baseUrl: string;
  /** Secret key sent as a Bearer token. */
  apiKey: string;
  /** Request timeout in milliseconds (default: 10 000). */
  timeoutMs?: number;
}

export class TerminalAfricaUnauthorizedError extends Error {
  constructor(shipmentId: string) {
    super(
      `Terminal Africa rejected the request for shipment "${shipmentId}": invalid API key (HTTP 401).`,
    );
    this.name = 'TerminalAfricaUnauthorizedError';
  }
}

export class TerminalAfricaNetworkError extends Error {
  constructor(shipmentId: string, cause: string) {
    super(
      `Network error while fetching Terminal Africa tracking for "${shipmentId}": ${cause}`,
    );
    this.name = 'TerminalAfricaNetworkError';
  }
}

export class TerminalAfricaProviderError extends Error {
  readonly statusCode: number;

  constructor(shipmentId: string, statusCode: number) {
    super(
      `Terminal Africa returned HTTP ${statusCode} for shipment "${shipmentId}".`,
    );
    this.name = 'TerminalAfricaProviderError';
    this.statusCode = statusCode;
  }
}

export class TerminalAfricaInvalidResponseError extends Error {
  constructor(shipmentId: string, reason: string) {
    super(
      `Terminal Africa returned a malformed response for shipment "${shipmentId}": ${reason}`,
    );
    this.name = 'TerminalAfricaInvalidResponseError';
  }
}

function isValidData(data: unknown): data is TerminalAfricaTrackingData {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return typeof record.status === 'string' && Array.isArray(record.events);
}

/** Thin HTTP wrapper; mapping lives in TerminalAfricaLogisticsService. */
export class TerminalAfricaClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: TerminalAfricaClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs ?? 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async fetchTracking(shipmentId: string): Promise<TerminalAfricaTrackingData> {
    let body: TerminalAfricaTrackingResponse;
    try {
      const response = await this.http.get<TerminalAfricaTrackingResponse>(
        `/shipments/track/${encodeURIComponent(shipmentId)}`,
        { headers: { Authorization: `Bearer ${this.options.apiKey}` } },
      );
      body = response.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (!err.response) {
          const cause =
            err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
              ? `request timed out (${err.code})`
              : err.message || 'unknown network error';
          throw new TerminalAfricaNetworkError(shipmentId, cause);
        }
        if (err.response.status === 401) {
          throw new TerminalAfricaUnauthorizedError(shipmentId);
        }
        throw new TerminalAfricaProviderError(shipmentId, err.response.status);
      }
      throw err;
    }

    if (!body || body.status !== true || !isValidData(body.data)) {
      throw new TerminalAfricaInvalidResponseError(
        shipmentId,
        body?.message || 'missing status or events',
      );
    }
    return body.data;
  }
}
