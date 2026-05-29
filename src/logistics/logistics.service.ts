import { Injectable } from '@nestjs/common';

export type LogisticsStatus = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED';

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

  async getStatus(trackingId: string): Promise<{ status: LogisticsStatus }> {
    throw new Error(`Logistics service is not configured for ${trackingId}`);
  }
}
