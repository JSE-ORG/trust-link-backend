import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import {
  encryptCredential,
  decryptCredential,
} from '../common/sanitization/credential-encryption.util';
import { PrismaService } from '../prisma/prisma.service';

/** Key used to identify the logistics provider's row in `ProviderCredential`. */
export const LOGISTICS_CREDENTIAL_PROVIDER = 'logistics';

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

  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadPersistedApiKey();
    if (!this.getApiKey()) {
      this.logger.warn(
        'Logistics provider is not configured. Real tracking lookups will fail.',
      );
    }
  }

  /**
   * Loads the logistics API key at startup, preferring a previously rotated
   * value persisted in `ProviderCredential` (issue #499) over the
   * `GIGL_API_TOKEN` environment variable. The environment variable remains
   * the fallback for a first boot with nothing stored yet.
   */
  private async loadPersistedApiKey(): Promise<void> {
    if (this.prisma) {
      try {
        const record = await (this.prisma as any).providerCredential.findUnique({
          where: { provider: LOGISTICS_CREDENTIAL_PROVIDER },
        });
        if (record) {
          this.apiKey = record.encryptedKey;
          return;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to load persisted logistics API key, falling back to environment: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const envToken = process.env.GIGL_API_TOKEN;
    if (envToken) {
      this.apiKey = encryptCredential(envToken);
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
   * Rotates the logistics provider API key to the given plaintext value
   * (issue #498): the submitted key is always the one that gets encrypted
   * and stored, whether or not a key was already present. The new value is
   * also persisted outside process memory (issue #499), via
   * `ProviderCredential`, so the rotation survives a restart and propagates
   * to other replicas. If no database is available (e.g. unit tests
   * constructing this service directly), the rotation still takes effect
   * in memory for the lifetime of the instance.
   */
  async rotateApiKey(key: string): Promise<void> {
    const encryptedKey = encryptCredential(key);
    this.apiKey = encryptedKey;

    if (this.prisma) {
      await (this.prisma as any).providerCredential.upsert({
        where: { provider: LOGISTICS_CREDENTIAL_PROVIDER },
        update: { encryptedKey },
        create: {
          provider: LOGISTICS_CREDENTIAL_PROVIDER,
          encryptedKey,
        },
      });
    }
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
