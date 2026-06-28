/**
 * Unit tests for GiglLogisticsService — tracking engine payload extraction
 * via the GIGL integration layer.
 *
 * Acceptance criteria:
 *  AC #1 — Raw provider response schema mapping is verified.
 *  AC #2 — Invalid token and network exception boundaries are tested.
 *
 * GiglClient is fully mocked so no HTTP calls are made.
 */

import { GiglLogisticsService } from './gigl-logistics.service';
import {
  GiglClient,
  GiglUnauthorizedError,
  GiglNetworkError,
  GiglProviderError,
} from './gigl.client';
import { GiglTrackingResponse } from './gigl.types';

// ── Fixture factory ──────────────────────────────────────────────────────────

function makeGiglResponse(
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
      {
        event_time: '2024-03-31T14:30:00Z',
        event_code: 'IN_TRANSIT',
        location: 'Abuja Sorting Centre',
        description: 'Parcel in transit to destination.',
      },
    ],
    ...overrides,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('GiglLogisticsService', () => {
  let client: jest.Mocked<Pick<GiglClient, 'fetchTracking'>>;
  let service: GiglLogisticsService;

  beforeEach(() => {
    client = { fetchTracking: jest.fn() };
    service = new GiglLogisticsService(client as unknown as GiglClient);
  });

  // ── AC #1: Raw provider response schema mapping ──────────────────────────

  describe('getStatus() — status field mapping (AC #1)', () => {
    it('returns DELIVERED when GIGL current_status is "DELIVERED"', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ current_status: 'DELIVERED' }),
      );

      const result = await service.getStatus('TRK-001');

      expect(result).toEqual({ status: 'DELIVERED' });
    });

    it('returns IN_TRANSIT when GIGL current_status is "IN_TRANSIT"', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ current_status: 'IN_TRANSIT' }),
      );

      const result = await service.getStatus('TRK-001');

      expect(result).toEqual({ status: 'IN_TRANSIT' });
    });

    it('returns IN_TRANSIT when GIGL current_status is "OUT_FOR_DELIVERY"', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ current_status: 'OUT_FOR_DELIVERY' }),
      );

      const result = await service.getStatus('TRK-001');

      expect(result).toEqual({ status: 'IN_TRANSIT' });
    });

    it('returns PENDING for any unknown GIGL status code', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ current_status: 'EXCEPTION' }),
      );

      const result = await service.getStatus('TRK-001');

      expect(result).toEqual({ status: 'PENDING' });
    });

    it('passes the correct tracking number to GiglClient', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse());

      await service.getStatus('MY-TRACKING-123');

      expect(client.fetchTracking).toHaveBeenCalledWith('MY-TRACKING-123');
    });
  });

  describe('getTrackingDetails() — full payload mapping (AC #1)', () => {
    it('maps carrier_code to carrier field', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ carrier_code: 'GIGL-EXPRESS' }),
      );

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.carrier).toBe('GIGL-EXPRESS');
    });

    it('converts estimated_delivery string to a Date object', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ estimated_delivery: '2024-04-01T18:00:00Z' }),
      );

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.estimatedDelivery).toBeInstanceOf(Date);
      expect(details.estimatedDelivery?.toISOString()).toBe(
        '2024-04-01T18:00:00.000Z',
      );
    });

    it('sets estimatedDelivery to undefined when estimated_delivery is null', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ estimated_delivery: null }),
      );

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.estimatedDelivery).toBeUndefined();
    });

    it('maps each event: converts event_time string to a Date', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse());

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events[0].timestamp).toBeInstanceOf(Date);
      expect(details.events[0].timestamp.toISOString()).toBe(
        '2024-03-30T08:00:00.000Z',
      );
    });

    it('maps each event: event_code becomes status', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse());

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events[0].status).toBe('PICKUP');
      expect(details.events[1].status).toBe('IN_TRANSIT');
    });

    it('maps each event: location string is preserved', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse());

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events[0].location).toBe('Lagos Hub');
    });

    it('maps each event: null location becomes undefined', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({
          events: [
            {
              event_time: '2024-03-30T08:00:00Z',
              event_code: 'PICKUP',
              location: null,
              description: 'Picked up.',
            },
          ],
        }),
      );

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events[0].location).toBeUndefined();
    });

    it('maps each event: description is preserved verbatim', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse());

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events[0].description).toBe(
        'Parcel picked up from sender.',
      );
    });

    it('preserves the correct number of events from the GIGL payload', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse()); // 2 events

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events).toHaveLength(2);
    });

    it('returns an empty events array when the GIGL response carries no events', async () => {
      client.fetchTracking.mockResolvedValue(makeGiglResponse({ events: [] }));

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.events).toEqual([]);
    });

    it('correctly maps status as part of getTrackingDetails', async () => {
      client.fetchTracking.mockResolvedValue(
        makeGiglResponse({ current_status: 'DELIVERED' }),
      );

      const details = await service.getTrackingDetails('TRK-001');

      expect(details.status).toBe('DELIVERED');
    });
  });

  // ── AC #2: Error boundary tests ──────────────────────────────────────────

  describe('getStatus() — error boundaries (AC #2)', () => {
    it('propagates GiglUnauthorizedError when the API token is invalid (401)', async () => {
      const error = new GiglUnauthorizedError('TRK-401');
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getStatus('TRK-401')).rejects.toThrow(
        GiglUnauthorizedError,
      );
      await expect(service.getStatus('TRK-401')).rejects.toThrow(
        /invalid or expired API token/i,
      );
    });

    it('propagates GiglNetworkError on connection timeout (ECONNABORTED)', async () => {
      const error = new GiglNetworkError(
        'TRK-TIMEOUT',
        'request timed out (ECONNABORTED)',
      );
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getStatus('TRK-TIMEOUT')).rejects.toThrow(
        GiglNetworkError,
      );
      await expect(service.getStatus('TRK-TIMEOUT')).rejects.toThrow(
        /network error/i,
      );
    });

    it('propagates GiglNetworkError on connection refused', async () => {
      const error = new GiglNetworkError(
        'TRK-CONN',
        'connect ECONNREFUSED 127.0.0.1:443',
      );
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getStatus('TRK-CONN')).rejects.toThrow(
        GiglNetworkError,
      );
    });

    it('propagates GiglProviderError when the upstream returns HTTP 500', async () => {
      const error = new GiglProviderError('TRK-ERR', 500);
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getStatus('TRK-ERR')).rejects.toThrow(
        GiglProviderError,
      );
      await expect(service.getStatus('TRK-ERR')).rejects.toThrow(/HTTP 500/);
    });

    it('propagates GiglProviderError when the upstream returns HTTP 503', async () => {
      const error = new GiglProviderError('TRK-503', 503);
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getStatus('TRK-503')).rejects.toThrow(
        GiglProviderError,
      );
    });
  });

  describe('getTrackingDetails() — error boundaries (AC #2)', () => {
    it('propagates GiglUnauthorizedError from getTrackingDetails on 401', async () => {
      const error = new GiglUnauthorizedError('TRK-401');
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getTrackingDetails('TRK-401')).rejects.toThrow(
        GiglUnauthorizedError,
      );
    });

    it('propagates GiglNetworkError from getTrackingDetails on timeout', async () => {
      const error = new GiglNetworkError(
        'TRK-TIMEOUT',
        'request timed out (ETIMEDOUT)',
      );
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getTrackingDetails('TRK-TIMEOUT')).rejects.toThrow(
        GiglNetworkError,
      );
      await expect(service.getTrackingDetails('TRK-TIMEOUT')).rejects.toThrow(
        /ETIMEDOUT/,
      );
    });

    it('propagates GiglProviderError from getTrackingDetails on HTTP 500', async () => {
      const error = new GiglProviderError('TRK-ERR', 500);
      client.fetchTracking.mockRejectedValue(error);

      await expect(service.getTrackingDetails('TRK-ERR')).rejects.toThrow(
        GiglProviderError,
      );
    });
  });

  // ── Error class structural assertions ────────────────────────────────────

  describe('Error class structure', () => {
    it('GiglUnauthorizedError has correct name property', () => {
      const err = new GiglUnauthorizedError('TRK-001');
      expect(err.name).toBe('GiglUnauthorizedError');
      expect(err).toBeInstanceOf(Error);
    });

    it('GiglNetworkError has correct name property', () => {
      const err = new GiglNetworkError('TRK-001', 'timeout');
      expect(err.name).toBe('GiglNetworkError');
      expect(err).toBeInstanceOf(Error);
    });

    it('GiglProviderError exposes the HTTP status code', () => {
      const err = new GiglProviderError('TRK-001', 502);
      expect(err.name).toBe('GiglProviderError');
      expect(err.statusCode).toBe(502);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
