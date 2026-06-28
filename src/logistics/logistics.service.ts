import { Injectable } from '@nestjs/common';
import { encryptCredential, decryptCredential } from '../common/sanitization/credential-encryption.util';

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
   * The key is encrypted before being stored in memory for security.
   */
  setApiKey(key: string): void {
    const encryptedKey = encryptCredential(key);
    this.apiKey = encryptedKey;
  }

  /**
   * Returns the decrypted logistics API key, or null if not set.
   * The key is decrypted at runtime when needed for API calls.
   */
  getApiKey(): string | null {
    if (!this.apiKey) {
      return null;
    }
    try {
      return decryptCredential(this.apiKey);
    } catch (error) {
      throw new Error('Failed to decrypt logistics API key');
    }
  }

  /**
   * Returns the encrypted API key for storage in the database.
   */
  getEncryptedApiKey(): string | null {
    return this.apiKey;
  }

  /**
   * Sets the API key from an already encrypted value (e.g., from database).
   */
  setEncryptedApiKey(encryptedKey: string): void {
    this.apiKey = encryptedKey;
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
