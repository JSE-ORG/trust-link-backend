/**
 * Unit tests for LogisticsProviderRegistry (issue #1146).
 *
 * Covers carrier detection rules, provider routing, and fallback behaviour.
 * No real HTTP calls or database access.
 */

import { LogisticsProviderRegistry, DEFAULT_CARRIER } from './logistics-provider.registry';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';
import { TrackingDetails } from './logistics.service';

function makeGiglService(): jest.Mocked<Pick<GiglLogisticsService, 'getStatus' | 'getTrackingDetails'>> {
  return {
    getStatus: jest.fn().mockResolvedValue({ status: 'IN_TRANSIT', events: [] } as TrackingDetails),
    getTrackingDetails: jest.fn().mockResolvedValue({ status: 'IN_TRANSIT', events: [] } as TrackingDetails),
  };
}

describe('LogisticsProviderRegistry', () => {
  let registry: LogisticsProviderRegistry;
  let gigl: ReturnType<typeof makeGiglService>;

  beforeEach(async () => {
    gigl = makeGiglService();
    registry = new LogisticsProviderRegistry(gigl as unknown as GiglLogisticsService);
    await registry.onModuleInit();
  });

  // ── Detection rules ────────────────────────────────────────────────────────

  describe('detectCarrier()', () => {
    it('returns GIGL for any tracking ID today (only one provider registered)', () => {
      expect(registry.detectCarrier('TRK-001')).toBe(DEFAULT_CARRIER);
      expect(registry.detectCarrier('1Z999AA10123456784')).toBe(DEFAULT_CARRIER);
      expect(registry.detectCarrier('GIGL-EXPRESS-00001')).toBe(DEFAULT_CARRIER);
    });
  });

  // ── Routing ───────────────────────────────────────────────────────────────

  describe('resolve()', () => {
    it('routes to GIGL when carrier is "GIGL"', () => {
      expect(registry.resolve('GIGL')).toBe(gigl);
    });

    it('routes to GIGL when carrier is null (pre-existing row)', () => {
      expect(registry.resolve(null)).toBe(gigl);
    });

    it('routes to GIGL when carrier is undefined', () => {
      expect(registry.resolve(undefined)).toBe(gigl);
    });

    it('routes to GIGL (default fallback) when carrier is unknown', () => {
      expect(registry.resolve('UNKNOWN_CARRIER')).toBe(gigl);
    });
  });

  // ── Fallback ──────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('calls the registered provider with the tracking ID', async () => {
      await registry.getStatus('GIGL', 'TRK-001');
      expect(gigl.getStatus).toHaveBeenCalledWith('TRK-001');
    });

    it('falls back to GIGL when carrier is null', async () => {
      await registry.getStatus(null, 'TRK-002');
      expect(gigl.getStatus).toHaveBeenCalledWith('TRK-002');
    });

    it('falls back to GIGL when carrier is unknown', async () => {
      await registry.getStatus('OTHER', 'TRK-003');
      expect(gigl.getStatus).toHaveBeenCalledWith('TRK-003');
    });
  });

  describe('getTrackingDetails()', () => {
    it('calls the registered provider with the tracking ID', async () => {
      await registry.getTrackingDetails('GIGL', 'TRK-004');
      expect(gigl.getTrackingDetails).toHaveBeenCalledWith('TRK-004');
    });

    it('falls back to GIGL when carrier is null', async () => {
      await registry.getTrackingDetails(null, 'TRK-005');
      expect(gigl.getTrackingDetails).toHaveBeenCalledWith('TRK-005');
    });
  });

  // ── DEFAULT_CARRIER constant ───────────────────────────────────────────────

  describe('DEFAULT_CARRIER', () => {
    it('is "GIGL"', () => {
      expect(DEFAULT_CARRIER).toBe('GIGL');
    });
  });
});
