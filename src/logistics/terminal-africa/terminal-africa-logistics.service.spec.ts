import {
  mapStatus,
  mapTrackingData,
  TerminalAfricaLogisticsService,
} from './terminal-africa-logistics.service';
import { TerminalAfricaClient } from './terminal-africa.client';

describe('Terminal Africa status mapping', () => {
  it.each([
    ['delivered', 'DELIVERED'],
    ['Delivered', 'DELIVERED'],
    ['in-transit', 'IN_TRANSIT'],
    ['in_transit', 'IN_TRANSIT'],
    ['picked-up', 'IN_TRANSIT'],
    ['out for delivery', 'IN_TRANSIT'],
    ['confirmed', 'PENDING'],
    ['draft', 'PENDING'],
    ['cancelled', 'PENDING'],
  ])('maps %j to %s', (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });

  it('maps the payload to the GIGL TrackingDetails shape', () => {
    expect(
      mapTrackingData({
        status: 'delivered',
        carrier: null,
        estimated_delivery: null,
        events: [
          {
            created_at: '2026-04-01T09:00:00Z',
            status: 'delivered',
            location: null,
            description: 'Delivered to recipient',
          },
        ],
      }),
    ).toEqual({
      status: 'DELIVERED',
      carrier: 'TERMINAL_AFRICA',
      estimatedDelivery: undefined,
      events: [
        {
          timestamp: new Date('2026-04-01T09:00:00Z'),
          status: 'delivered',
          location: undefined,
          description: 'Delivered to recipient',
        },
      ],
    });
  });
});

describe('TerminalAfricaLogisticsService', () => {
  it('fetches and maps tracking through the client', async () => {
    const client = {
      fetchTracking: jest.fn().mockResolvedValue({
        status: 'in-transit',
        carrier: 'GIG',
        estimated_delivery: '2026-04-03T00:00:00Z',
        events: [],
      }),
    } as unknown as TerminalAfricaClient;
    const service = new TerminalAfricaLogisticsService(client);

    await expect(service.getTrackingDetails('SH1')).resolves.toEqual({
      status: 'IN_TRANSIT',
      carrier: 'GIG',
      estimatedDelivery: new Date('2026-04-03T00:00:00Z'),
      events: [],
    });
    expect(client.fetchTracking).toHaveBeenCalledWith('SH1');
  });

  it('propagates client errors', async () => {
    const client = {
      fetchTracking: jest.fn().mockRejectedValue(new Error('down')),
    } as unknown as TerminalAfricaClient;
    await expect(
      new TerminalAfricaLogisticsService(client).getStatus('SH1'),
    ).rejects.toThrow('down');
  });

  it('rejects when no client is configured', async () => {
    await expect(
      new TerminalAfricaLogisticsService(null).getStatus('SH1'),
    ).rejects.toThrow('Terminal Africa is not configured for SH1');
  });
});
