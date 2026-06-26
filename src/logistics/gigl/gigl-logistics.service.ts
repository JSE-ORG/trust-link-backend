import { Injectable } from '@nestjs/common';
import {
  LogisticsService,
  LogisticsStatus,
  TrackingDetails,
  TrackingEvent,
} from '../logistics.service';
import { GiglClient } from './gigl.client';
import { GiglTrackingEvent, GiglTrackingResponse } from './gigl.types';

/**
 * Maps the raw `current_status` string from GIGL to the internal
 * `LogisticsStatus` union type.
 */
function mapStatus(giglStatus: string): LogisticsStatus {
  switch (giglStatus) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'IN_TRANSIT':
    case 'OUT_FOR_DELIVERY':
      return 'IN_TRANSIT';
    default:
      return 'PENDING';
  }
}

/**
 * Maps a single GIGL event to the internal `TrackingEvent` shape.
 */
function mapEvent(raw: GiglTrackingEvent): TrackingEvent {
  return {
    timestamp: new Date(raw.event_time),
    status: raw.event_code,
    location: raw.location ?? undefined,
    description: raw.description,
  };
}

/**
 * Maps the full GIGL tracking response payload to the internal
 * `TrackingDetails` shape used by `LogisticsService`.
 */
function mapTrackingResponse(raw: GiglTrackingResponse): TrackingDetails {
  return {
    status: mapStatus(raw.current_status),
    carrier: raw.carrier_code,
    estimatedDelivery: raw.estimated_delivery
      ? new Date(raw.estimated_delivery)
      : undefined,
    events: raw.events.map(mapEvent),
  };
}

/**
 * Concrete `LogisticsService` implementation backed by the GIGL provider.
 *
 * Delegates all HTTP concerns to `GiglClient`; this class is pure mapping
 * logic and can be tested fully with a mocked client.
 */
@Injectable()
export class GiglLogisticsService extends LogisticsService {
  constructor(private readonly client: GiglClient) {
    super();
  }

  /**
   * Returns the normalised shipment status for a given tracking ID.
   * Errors from GiglClient (unauthorized, network, provider) propagate
   * unchanged to the caller.
   */
  async getStatus(
    trackingId: string,
  ): Promise<{ status: LogisticsStatus }> {
    const raw = await this.client.fetchTracking(trackingId);
    return { status: mapStatus(raw.current_status) };
  }

  /**
   * Returns full tracking details for a given tracking ID.
   * Errors from GiglClient propagate unchanged to the caller.
   */
  async getTrackingDetails(trackingId: string): Promise<TrackingDetails> {
    const raw = await this.client.fetchTracking(trackingId);
    return mapTrackingResponse(raw);
  }
}

// Re-export the mapping helpers for use in tests
export { mapStatus, mapEvent, mapTrackingResponse };
