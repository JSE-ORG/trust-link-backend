import axios, { AxiosInstance } from 'axios';
import {
  TerminalAfricaClient,
  TerminalAfricaInvalidResponseError,
  TerminalAfricaNetworkError,
  TerminalAfricaProviderError,
  TerminalAfricaUnauthorizedError,
} from './terminal-africa.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const validBody = {
  status: true,
  message: 'Shipment tracked',
  data: {
    status: 'in-transit',
    carrier: 'DHL',
    estimated_delivery: '2026-04-03T00:00:00Z',
    events: [
      {
        created_at: '2026-04-01T09:00:00Z',
        status: 'picked-up',
        location: 'Lagos',
        description: 'Picked up',
      },
    ],
  },
};

function axiosError(partial: {
  code?: string;
  message?: string;
  status?: number;
}) {
  return {
    isAxiosError: true,
    code: partial.code,
    message: partial.message ?? '',
    response: partial.status ? { status: partial.status } : undefined,
  };
}

describe('TerminalAfricaClient', () => {
  let get: jest.Mock;
  let client: TerminalAfricaClient;

  beforeEach(() => {
    get = jest.fn();
    mockedAxios.create.mockReturnValue({ get } as unknown as AxiosInstance);
    mockedAxios.isAxiosError.mockImplementation(
      (e: unknown) => (e as { isAxiosError?: boolean })?.isAxiosError === true,
    );
    client = new TerminalAfricaClient({
      baseUrl: 'https://api.terminal.africa/v1',
      apiKey: 'sk_test_123',
    });
  });

  it('configures the base URL and timeout', () => {
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.terminal.africa/v1',
        timeout: 10_000,
      }),
    );
  });

  it('GETs the encoded track path with the Bearer key and returns data', async () => {
    get.mockResolvedValue({ data: validBody });

    const data = await client.fetchTracking('SH/1 2');

    expect(get).toHaveBeenCalledWith('/shipments/track/SH%2F1%202', {
      headers: { Authorization: 'Bearer sk_test_123' },
    });
    expect(data).toEqual(validBody.data);
  });

  it('maps 401 to TerminalAfricaUnauthorizedError', async () => {
    get.mockRejectedValue(axiosError({ status: 401 }));
    await expect(client.fetchTracking('SH1')).rejects.toBeInstanceOf(
      TerminalAfricaUnauthorizedError,
    );
  });

  it.each([404, 500])(
    'maps HTTP %i to TerminalAfricaProviderError',
    async (status) => {
      get.mockRejectedValue(axiosError({ status }));
      await expect(client.fetchTracking('SH1')).rejects.toMatchObject({
        name: 'TerminalAfricaProviderError',
        statusCode: status,
      });
      await expect(client.fetchTracking('SH1')).rejects.toBeInstanceOf(
        TerminalAfricaProviderError,
      );
    },
  );

  it.each(['ECONNABORTED', 'ETIMEDOUT'])(
    'maps %s to a timeout network error',
    async (code) => {
      get.mockRejectedValue(axiosError({ code }));
      await expect(client.fetchTracking('SH1')).rejects.toThrow(
        new TerminalAfricaNetworkError('SH1', `request timed out (${code})`),
      );
    },
  );

  it('respects a custom timeoutMs option when provided', () => {
    mockedAxios.create.mockClear();
    new TerminalAfricaClient({
      baseUrl: 'https://api.terminal.africa/v1',
      apiKey: 'sk_test_123',
      timeoutMs: 5_000,
    });
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.terminal.africa/v1',
        timeout: 5_000,
      }),
    );
  });

  it('maps other network failures to TerminalAfricaNetworkError', async () => {
    get.mockRejectedValue(
      axiosError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }),
    );
    await expect(client.fetchTracking('SH1')).rejects.toThrow(
      'connect ECONNREFUSED',
    );
  });

  it('falls back to "unknown network error" when an axios network error has no message', async () => {
    get.mockRejectedValue(axiosError({ code: 'ENOTFOUND', message: '' }));
    await expect(client.fetchTracking('SH1')).rejects.toThrow(
      new TerminalAfricaNetworkError('SH1', 'unknown network error'),
    );
  });

  it('rethrows non-axios errors unchanged', async () => {
    const boom = new Error('boom');
    get.mockRejectedValue(boom);
    await expect(client.fetchTracking('SH1')).rejects.toBe(boom);
  });

  it.each([
    [
      'status false',
      { ...validBody, status: false, message: 'Shipment not found' },
    ],
    ['missing events', { ...validBody, data: { status: 'delivered' } }],
    ['null data', { ...validBody, message: '', data: null }],
    ['empty body', ''],
  ])('rejects a 2xx with %s', async (_name, body) => {
    get.mockResolvedValue({ data: body });
    await expect(client.fetchTracking('SH1')).rejects.toBeInstanceOf(
      TerminalAfricaInvalidResponseError,
    );
  });
});
