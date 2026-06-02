import {
  TerminalAfricaPayloadMapError,
  TerminalAfricaRateLimitError,
  parseTerminalAfricaTrackingDetails,
} from '../../src/logistics/providers/terminal-africa.provider';

describe('Terminal Africa tracking parser', () => {
  it('parses valid tracking details and status records', () => {
    const response = {
      status: 200,
      data: {
        tracking: {
          status: 'DELIVERED',
          carrier: 'Terminal Africa',
          estimatedDelivery: '2026-07-01T12:00:00.000Z',
          statusRecords: [
            {
              recordedAt: '2026-06-20T08:00:00.000Z',
              status: 'PICKED_UP',
              location: 'Nairobi, Kenya',
              description: 'Shipment picked up by carrier',
            },
            {
              recordedAt: '2026-06-22T14:30:00.000Z',
              status: 'DELIVERED',
              location: 'Mombasa, Kenya',
              description: 'Shipment delivered to recipient',
            },
          ],
        },
      },
    };

    const result = parseTerminalAfricaTrackingDetails(response);

    expect(result).toEqual({
      status: 'DELIVERED',
      carrier: 'Terminal Africa',
      estimatedDelivery: new Date('2026-07-01T12:00:00.000Z'),
      events: [
        {
          timestamp: new Date('2026-06-20T08:00:00.000Z'),
          status: 'PICKED_UP',
          location: 'Nairobi, Kenya',
          description: 'Shipment picked up by carrier',
        },
        {
          timestamp: new Date('2026-06-22T14:30:00.000Z'),
          status: 'DELIVERED',
          location: 'Mombasa, Kenya',
          description: 'Shipment delivered to recipient',
        },
      ],
    });
  });

  it('throws a rate limit error when response indicates 429 status', () => {
    const response = {
      status: 429,
      message: 'Too many requests - rate limit exceeded',
    };

    expect(() => parseTerminalAfricaTrackingDetails(response)).toThrow(
      TerminalAfricaRateLimitError,
    );
  });

  it('throws a rate limit error when the response contains a rate limit code', () => {
    const response = {
      status: 403,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: 'Carrier API limited requests',
    };

    expect(() => parseTerminalAfricaTrackingDetails(response)).toThrow(
      TerminalAfricaRateLimitError,
    );
  });

  it('throws a payload map error when tracking payload is missing', () => {
    const response = {
      status: 200,
      data: {},
    };

    expect(() => parseTerminalAfricaTrackingDetails(response)).toThrow(
      TerminalAfricaPayloadMapError,
    );
  });

  it('parses successfully with an empty events list when no records are present', () => {
    const response = {
      status: 200,
      data: {
        tracking: {
          status: 'IN_TRANSIT',
          carrier: 'Terminal Africa',
          estimatedDelivery: '2026-08-01T10:00:00.000Z',
          statusRecords: [],
        },
      },
    };

    const result = parseTerminalAfricaTrackingDetails(response);

    expect(result).toEqual({
      status: 'IN_TRANSIT',
      carrier: 'Terminal Africa',
      estimatedDelivery: new Date('2026-08-01T10:00:00.000Z'),
      events: [],
    });
  });
});
