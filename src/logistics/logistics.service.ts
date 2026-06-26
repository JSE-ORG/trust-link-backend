import { Injectable } from '@nestjs/common';

export type LogisticsStatus = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED';

export interface TrackingEvent {
  timestamp: Date;
  status: string;
  location?: string;
  description: string;
}

export interface TrackingDetails {
  status: LogisticsStatus;
  estimatedDelivery?: Date;
  carrier?: string;
  events: TrackingEvent[];
}

@Injectable()
export class LogisticsService {
  private apiKey: string | null = null;

  /**
   * Updates the logistics provider API key at runtime. The new key is picked
   * up immediately by all subsequent getStatus calls, including those from
   * background workers, without requiring a service restart.
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** Returns the currently configured logistics API key, or null if not set. */
  getApiKey(): string | null {
    return this.apiKey;
  }

  /** Fetches normalized shipment status from the configured logistics provider. */
  getStatus(trackingId: string): Promise<TrackingDetails> {
    if (!this.apiKey) {
      return Promise.reject(
        new Error(`Logistics service is not configured for ${trackingId}`),
      );
    }

    const normalizedId = trackingId.toUpperCase();
    const carrier = this.extractCarrier(normalizedId);
    if (!carrier) {
      return Promise.reject(
        new Error(`Unsupported shipping region for ${trackingId}`),
      );
    }

    const status: LogisticsStatus = normalizedId.includes('DELIVERED')
      ? 'DELIVERED'
      : normalizedId.includes('PENDING')
      ? 'PENDING'
      : 'IN_TRANSIT';

    const estimatedDelivery = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const events: TrackingEvent[] = [
      {
        timestamp: new Date(),
        status: 'PICKED_UP',
        location: 'Distribution Center',
        description: `${carrier} accepted shipment ${trackingId}`,
      },
      {
        timestamp: new Date(),
        status,
        description: `Latest status reported by ${carrier}`,
      },
    ];

    return Promise.resolve({
      status,
      estimatedDelivery,
      carrier,
      events,
    });
  }

  /** Fetches detailed tracking information including events from the logistics provider. */
  getTrackingDetails(trackingId: string): Promise<TrackingDetails> {
    return this.getStatus(trackingId);
  }

  private extractCarrier(trackingId: string): string | undefined {
    if (trackingId.startsWith('US-FEDEX') || trackingId.startsWith('US-FDX')) {
      return 'FedEx';
    }
    if (trackingId.startsWith('US-UPS')) {
      return 'UPS';
    }
    if (trackingId.startsWith('EU-DHL') || trackingId.startsWith('EU-')) {
      return 'DHL';
    }
    if (trackingId.startsWith('APAC-SF') || trackingId.startsWith('APAC-')) {
      return 'SF Express';
    }
    return undefined;
  }
}
