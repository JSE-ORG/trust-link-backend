import { LogisticsService } from '../../src/logistics/logistics.service';

describe('LogisticsService (issue #43)', () => {
  let service: LogisticsService;

  beforeEach(() => {
    service = new LogisticsService();
  });

  it('stores and returns the API key at runtime', () => {
    expect(service.getApiKey()).toBeNull();
    service.setApiKey('secret-key');
    expect(service.getApiKey()).toBe('secret-key');
  });

  it('routes US-FEDEX tracking IDs to FedEx', async () => {
    service.setApiKey('secret-key');

    const details = await service.getStatus('US-FEDEX-0001');

    expect(details.carrier).toBe('FedEx');
    expect(details.status).toBe('IN_TRANSIT');
    expect(details.events).toHaveLength(2);
    expect(details.events[0].description).toContain('FedEx accepted shipment');
  });

  it('routes EU-DHL tracking IDs to DHL', async () => {
    service.setApiKey('secret-key');

    const details = await service.getStatus('EU-DHL-ABC123');

    expect(details.carrier).toBe('DHL');
    expect(details.status).toBe('IN_TRANSIT');
  });

  it('routes US-UPS tracking IDs to UPS', async () => {
    service.setApiKey('secret-key');

    const details = await service.getStatus('US-UPS-9876');

    expect(details.carrier).toBe('UPS');
    expect(details.status).toBe('IN_TRANSIT');
  });

  it('returns a fallback error for unsupported regions', async () => {
    service.setApiKey('secret-key');

    await expect(service.getStatus('XX-UNKNOWN-000')).rejects.toThrow(
      'Unsupported shipping region',
    );
  });

  it('rejects requests when the logistics service is not configured', async () => {
    await expect(service.getStatus('US-FEDEX-0001')).rejects.toThrow(
      'Logistics service is not configured',
    );
  });
});
