export interface TerminalAfricaStatusRecord {
  recordedAt?: string;
  timestamp?: string;
  time?: string | number;
  status: string;
  location?: string;
  city?: string;
  description?: string;
  details?: string;
}

export interface TerminalAfricaTrackingPayload {
  status?: string;
  carrier?: string;
  estimatedDelivery?: string;
  statusRecords?: TerminalAfricaStatusRecord[];
  records?: TerminalAfricaStatusRecord[];
}

export interface TerminalAfricaResponse {
  status?: number;
  code?: string;
  errorCode?: string;
  message?: string;
  data?: {
    tracking?: TerminalAfricaTrackingPayload;
    status?: string;
    carrier?: string;
    estimatedDelivery?: string;
    statusRecords?: TerminalAfricaStatusRecord[];
    records?: TerminalAfricaStatusRecord[];
  };
  tracking?: TerminalAfricaTrackingPayload;
}

export interface TerminalAfricaTrackingEvent {
  timestamp: Date;
  status: string;
  location?: string;
  description: string;
}

export interface TerminalAfricaTrackingDetails {
  status: string;
  estimatedDelivery?: Date;
  carrier?: string;
  events: TerminalAfricaTrackingEvent[];
}

export class TerminalAfricaRateLimitError extends Error {
  readonly name = 'TerminalAfricaRateLimitError';

  constructor(message = 'Terminal Africa rate limit exceeded') {
    super(message);
  }
}

export class TerminalAfricaPayloadMapError extends Error {
  readonly name = 'TerminalAfricaPayloadMapError';

  constructor(message = 'Missing Terminal Africa tracking payload map') {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function getTrackingPayload(rawResponse: TerminalAfricaResponse): TerminalAfricaTrackingPayload | undefined {
  if (isObject(rawResponse.data) && isObject(rawResponse.data.tracking)) {
    return rawResponse.data.tracking;
  }

  if (isObject(rawResponse.tracking)) {
    return rawResponse.tracking;
  }

  if (isObject(rawResponse.data)) {
    const { status, carrier, estimatedDelivery, statusRecords, records } = rawResponse.data;
    return { status, carrier, estimatedDelivery, statusRecords, records };
  }

  return undefined;
}

export function parseTerminalAfricaTrackingDetails(
  rawResponse: unknown,
): TerminalAfricaTrackingDetails {
  if (!isObject(rawResponse)) {
    throw new Error('Invalid Terminal Africa response');
  }

  const statusCode = typeof rawResponse.status === 'number' ? rawResponse.status : undefined;
  const code = typeof rawResponse.code === 'string' ? rawResponse.code : undefined;
  const errorCode = typeof rawResponse.errorCode === 'string' ? rawResponse.errorCode : undefined;
  const message = typeof rawResponse.message === 'string' ? rawResponse.message : '';

  const isRateLimited =
    statusCode === 429 ||
    /rate limit/i.test(message) ||
    code === 'RATE_LIMIT' ||
    errorCode === 'RATE_LIMIT_EXCEEDED';

  if (isRateLimited) {
    throw new TerminalAfricaRateLimitError(
      message || 'Terminal Africa rate limit exceeded',
    );
  }

  const payload = getTrackingPayload(rawResponse);
  if (!payload) {
    throw new TerminalAfricaPayloadMapError();
  }

  const status = typeof payload.status === 'string' ? payload.status : undefined;
  if (!status) {
    throw new TerminalAfricaPayloadMapError(
      'Missing Terminal Africa status payload',
    );
  }

  const estimatedDelivery = parseDate(payload.estimatedDelivery);
  const carrier = typeof payload.carrier === 'string' ? payload.carrier : undefined;
  const records =
    Array.isArray(payload.statusRecords) && payload.statusRecords.length > 0
      ? payload.statusRecords
      : Array.isArray(payload.records)
      ? payload.records
      : [];

  const events = records.map((record) => {
    if (!isObject(record)) {
      throw new TerminalAfricaPayloadMapError(
        'Invalid Terminal Africa status record',
      );
    }

    const timestamp = parseDate(
      record.recordedAt ?? record.timestamp ?? record.time,
    );
    if (!timestamp) {
      throw new TerminalAfricaPayloadMapError(
        'Missing or invalid terminal africa status record timestamp',
      );
    }

    const statusValue =
      typeof record.status === 'string'
        ? record.status
        : typeof record['currentStatus'] === 'string'
        ? record['currentStatus']
        : 'UNKNOWN';

    const location =
      typeof record.location === 'string'
        ? record.location
        : typeof record.city === 'string'
        ? record.city
        : undefined;

    const description =
      typeof record.description === 'string'
        ? record.description
        : typeof record.details === 'string'
        ? record.details
        : '';

    return {
      timestamp,
      status: statusValue,
      location,
      description,
    };
  });

  return {
    status,
    estimatedDelivery,
    carrier,
    events,
  };
}
