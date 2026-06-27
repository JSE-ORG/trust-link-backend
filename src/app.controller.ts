import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppService } from './app.service';
import { getAppVersion } from './common/version';
import { ConfigService } from './config/config.service';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './cache/cache.service';

type ComponentStatus = 'ok' | 'down';
// Redis is optional infrastructure, so it has an extra 'disabled' state and does
// not, by itself, make the service unhealthy (issue #31 — graceful fallback).
type OptionalComponentStatus = ComponentStatus | 'disabled';

interface ComponentHealth {
  status: ComponentStatus;
  error?: string;
}

interface HealthBody {
  status: ComponentStatus;
  db: ComponentStatus;
  horizon: ComponentStatus;
  redis: OptionalComponentStatus;
  timestamp: string;
  environment: string;
  version: string;
  durationMs: number;
  details?: {
    db?: ComponentHealth;
    horizon?: ComponentHealth;
    redis?: ComponentHealth;
  };
}

const HORIZON_URLS: Record<'TESTNET' | 'MAINNET', string> = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
};

const HORIZON_TIMEOUT_MS = 150;

@ApiTags('Health')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  @ApiOperation({ summary: 'Root endpoint — welcome message' })
  @ApiResponse({ status: 200, description: 'Service welcome message.' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health check endpoint that verifies database connectivity,
   * Stellar Horizon reachability, and Redis status. Redis is
   * optional — a disabled or down Redis does not affect the
   * overall health status.
   *
   * @param res - Express response object
   * @returns Health status with component-level details, version, and timing
   * @authentication None (public endpoint)
   */
  @ApiOperation({ summary: 'Service health check — database, Horizon, and Redis' })
  @ApiResponse({ status: 200, description: 'All components healthy.' })
  @ApiResponse({ status: 503, description: 'One or more components are down.' })
  @Get('health')
  async getHealth(@Res() res: Response): Promise<Response<HealthBody>> {
    const start = Date.now();

    const [dbResult, horizonResult, redisResult] = await Promise.all([
      this.checkDatabase().catch((err: unknown) => ({
        status: 'down' as ComponentStatus,
        error: err instanceof Error ? err.message : 'Database check failed',
      })),
      this.checkHorizon().catch((err: unknown) => ({
        status: 'down' as ComponentStatus,
        error: err instanceof Error ? err.message : 'Horizon check failed',
      })),
      this.checkRedis().catch((err: unknown) => ({
        status: 'down' as ComponentStatus,
        error: err instanceof Error ? err.message : 'Redis check failed',
      })),
    ]);

    const redisStatus: OptionalComponentStatus = 'rawStatus' in redisResult && redisResult.rawStatus === 'disabled'
      ? 'disabled'
      : redisResult.status === 'ok'
        ? 'ok'
        : 'down';

    // Redis is optional: a 'disabled' or 'down' Redis is reported but does not
    // flip the overall status to unhealthy (graceful fallback — issue #31).
    const allOk = dbResult.status === 'ok' && horizonResult.status === 'ok';

    if (!allOk) {
      this.logger.warn(
        `Health check failed: db=${dbResult.status}, horizon=${horizonResult.status}, redis=${redisStatus}`,
      );
    }

    const body: HealthBody = {
      status: allOk ? 'ok' : 'down',
      db: dbResult.status,
      horizon: horizonResult.status,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
      environment: this.configService.get('NODE_ENV'),
      version: getAppVersion(),
      durationMs: Date.now() - start,
    };

    if (!allOk) {
      body.details = {};
      if (dbResult.status === 'down') {
        body.details.db = { status: 'down', error: dbResult.error };
      }
      if (horizonResult.status === 'down') {
        body.details.horizon = { status: 'down', error: horizonResult.error };
      }
    }

    return res
      .status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(body);
  }

  /**
   * Returns the application version and environment information.
   *
   * @returns Version string, package name, and current environment
   * @authentication None (public endpoint)
   */
  @ApiOperation({ summary: 'Get current application version and environment' })
  @ApiResponse({ status: 200, description: 'Version information returned.' })
  @Get('version')
  @HttpCode(HttpStatus.OK)
  getVersion() {
    return {
      version: getAppVersion(),
      name: '@truestlink/trustlink-backend',
      environment: this.configService.get('NODE_ENV'),
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    try {
      await this.prismaService.escrow.findMany({});
      return { status: 'ok' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Database connection failed';
      this.logger.error(`Database health check failed: ${message}`);
      return { status: 'down', error: message };
    }
  }

  private async checkHorizon(): Promise<ComponentHealth> {
    const network = this.configService.get('STELLAR_NETWORK');
    const horizonUrl = HORIZON_URLS[network];
    if (!horizonUrl) {
      const error = `Invalid network configuration: ${network}`;
      this.logger.error(`Horizon health check failed: ${error}`);
      return { status: 'down', error };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HORIZON_TIMEOUT_MS);

    try {
      const response = await fetch(horizonUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      if (response.ok) {
        return { status: 'ok' };
      }
      const error = `Horizon returned status ${response.status}`;
      this.logger.error(`Horizon health check failed: ${error}`);
      return { status: 'down', error };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Horizon connection failed';
      this.logger.error(`Horizon health check failed: ${message}`);
      return { status: 'down', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkRedis(): Promise<ComponentHealth & { rawStatus?: string }> {
    const result = await this.cacheService.ping();
    if (result === 'ok') {
      return { status: 'ok' };
    }
    const error = result === 'disabled' ? 'Redis not configured' : 'Redis connection failed';
    return { status: 'down', error, rawStatus: result };
  }
}
