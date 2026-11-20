import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { LogisticsService, TrackingDetails } from './logistics.service';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';

/**
 * Default carrier used when an escrow has no `carrier` stored (pre-existing
 * rows) or when auto-detection from the tracking ID does not match a known
 * pattern.
 */
export const DEFAULT_CARRIER = 'GIGL';

/**
 * Registry that routes tracking calls to the correct logistics provider based
 * on an escrow's `carrier` column (issue #1146).
 *
 * Today only GIGL is registered. A second provider plugs in by being injected
 * here and registered under its carrier name in {@link onModuleInit}. The
 * {@link resolve} method falls back to {@link DEFAULT_CARRIER} when the stored
 * carrier is null or unknown, so pre-existing rows (null carrier) are handled
 * by GIGL.
 */
@Injectable()
export class LogisticsProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(LogisticsProviderRegistry.name);
  private readonly providers = new Map<string, LogisticsService>();

  constructor(
    @Optional()
    @Inject(GiglLogisticsService)
    private readonly giglService?: GiglLogisticsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.giglService) {
      this.register(DEFAULT_CARRIER, this.giglService);
    } else {
      this.logger.warn('No logistics provider is registered.');
    }
  }

  /**
   * Registers a provider under a carrier name. Called during module
   * initialisation for built-in providers and may be called at runtime for
   * dynamically added ones.
   */
  register(carrier: string, service: LogisticsService): void {
    this.providers.set(carrier, service);
  }

  /**
   * Detects the carrier from the tracking ID format.
   *
   * Only GIGL is registered today, so every tracking ID resolves to GIGL.
   * When a second provider is added, its detection pattern is added here —
   * for example a regex that matches that provider's tracking-number format.
   * The default fallback is always {@link DEFAULT_CARRIER}.
   */
  detectCarrier(trackingId: string): string {
    return DEFAULT_CARRIER;
  }

  /**
   * Resolves the provider for a carrier, falling back to the default carrier
   * when the stored carrier is null or not in the registry.
   */
  resolve(carrier: string | null | undefined): LogisticsService {
    const key = carrier ?? DEFAULT_CARRIER;
    return (
      this.providers.get(key) ??
      this.providers.get(DEFAULT_CARRIER) ??
      this.giglService!
    );
  }

  /** Delegates `getStatus` to the provider registered for `carrier`. */
  async getStatus(
    carrier: string | null,
    trackingId: string,
  ): Promise<TrackingDetails> {
    return this.resolve(carrier).getStatus(trackingId);
  }

  /** Delegates `getTrackingDetails` to the provider registered for `carrier`. */
  async getTrackingDetails(
    carrier: string | null,
    trackingId: string,
  ): Promise<TrackingDetails> {
    return this.resolve(carrier).getTrackingDetails(trackingId);
  }
}
