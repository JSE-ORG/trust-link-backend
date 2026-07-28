import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  encryptCredential,
  decryptCredential,
} from '../common/sanitization/credential-encryption.util';

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
export class LogisticsService implements OnModuleInit {
  protected readonly logger = new Logger(LogisticsService.name);
  private apiKey: string | null = null;

  onModuleInit(): void {
    if (!this.getApiKey()) {
      this.logger.warn(
        'Logistics provider is not configured. Real tracking lookups will fail.',
      );
    }
  }

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
    } catch {
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
    return Promise.reject(
      new Error(`Logistics service is not configured for ${trackingId}`),
    );
  }

  /** Fetches detailed tracking information including events from the logistics provider. */
  getTrackingDetails(trackingId: string): Promise<TrackingDetails> {
    return this.getStatus(trackingId);
  }
}
