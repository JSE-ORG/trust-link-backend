import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  LogisticsService,
  LogisticsStatus,
  TrackingDetails,
  TrackingEvent,
} from '../logistics.service';
import { TerminalAfricaClient } from './terminal-africa.client';
import {
  TerminalAfricaTrackingData,
  TerminalAfricaTrackingEvent,
} from './terminal-africa.types';

const IN_TRANSIT_STATUSES = new Set([
  'in_transit',
  'picked_up',
  'out_for_delivery',
]);

/** Maps a Terminal Africa status ("in-transit", "Delivered", ...) to ours. */
export function mapStatus(status: string): LogisticsStatus {
  const normalised = status
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (normalised === 'delivered') return 'DELIVERED';
  if (IN_TRANSIT_STATUSES.has(normalised)) return 'IN_TRANSIT';
  return 'PENDING';
}

export function mapEvent(raw: TerminalAfricaTrackingEvent): TrackingEvent {
  return {
    timestamp: new Date(raw.created_at),
    status: raw.status,
    location: raw.location ?? undefined,
    description: raw.description,
  };
}

export function mapTrackingData(
  raw: TerminalAfricaTrackingData,
): TrackingDetails {
  return {
    status: mapStatus(raw.status),
    carrier: raw.carrier ?? 'TERMINAL_AFRICA',
    estimatedDelivery: raw.estimated_delivery
      ? new Date(raw.estimated_delivery)
      : undefined,
    events: raw.events.map(mapEvent),
  };
}

/**
 * Second logistics provider, returning the same `TrackingDetails` shape as
 * GIGL. Not bound to `LogisticsService`: GIGL stays the active provider.
 */
@Injectable()
export class TerminalAfricaLogisticsService implements Pick<
  LogisticsService,
  'getStatus' | 'getTrackingDetails'
> {
  constructor(
    @Optional()
    @Inject(TerminalAfricaClient)
    private readonly client?: TerminalAfricaClient | null,
  ) {}

  async getStatus(trackingId: string): Promise<TrackingDetails> {
    if (!this.client) {
      throw new Error(`Terminal Africa is not configured for ${trackingId}`);
    }
    return mapTrackingData(await this.client.fetchTracking(trackingId));
  }

  getTrackingDetails(trackingId: string): Promise<TrackingDetails> {
    return this.getStatus(trackingId);
  }
}
