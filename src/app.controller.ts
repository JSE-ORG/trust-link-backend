import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppService } from './app.service';
import { getAppVersion } from './common/version';
import { ConfigService } from './config/config.service';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './cache/cache.service';
import { LivenessResponseDto } from './common/dto/liveness-response.dto';
import { ReadinessResponseDto } from './common/dto/readiness-response.dto';
import { ErrorResponseDto } from './common/dto/error-response.dto';

type ComponentStatus = 'ok' | 'down';
// Redis is optional infrastructure, so it has an extra 'disabled' state and does
// not, by itself, make the service unhealthy (issue #31 — graceful fallback).
type OptionalComponentStatus = ComponentStatus | 'disabled';

interface ComponentHealth {
  status: ComponentStatus;
  error?: string;
}

interface DependencyCheckResults {
  db: ComponentHealth;
  horizon: ComponentHealth;
  redis: ComponentHealth & { rawStatus?: string };
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
  @Throttle({ public: { limit: 100, ttl: 60000 } })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Lightweight liveness probe. Returns 200 immediately without touching any
   * external dependency. Used by orchestrators to answer "is the process
   * still alive and able to serve HTTP?". A failure here triggers a container
   * restart, so this endpoint must NEVER depend on the database, Horizon or
   * Redis — a transient external outage must not turn into a restart loop.
   *
   * @returns Basic process identity fields (timestamp, env, version)
   * @authentication None (public endpoint)
   */
  @ApiOperation({
    summary:
      'Liveness probe — always returns 200 when the HTTP server is reachable. No dependency checks.',
  })
  @ApiOkResponse({
    description: 'Process is alive and serving HTTP.',
    type: LivenessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Get('health/live')
  @HttpCode(HttpStatus.OK)
  getLiveness(): LivenessResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: this.configService.get('NODE_ENV'),
      version: getAppVersion(),
    };
  }

  /**
   * Readiness probe that verifies database connectivity, Stellar Horizon
   * reachability, and Redis status. Returns 503 when PostgreSQL or Horizon
   * is unavailable; Redis is optional (graceful fallback — issue #31).
   * Used by load balancers and orchestrators to decide whether this
   * instance should receive production traffic.
   *
   * This endpoint is intentionally heavier than the liveness probe: every
   * call performs a DB query, a Horizon fetch and a Redis PING.
   *
   * @param res - Express response object
   * @returns Per-component status, version, timing, and optional error details
   * @authentication None (public endpoint)
   */
  @ApiOperation({
    summary:
      'Readiness probe — checks database, Horizon, and Redis; returns 503 on downstream failure.',
  })
  @ApiOkResponse({
    description: 'All required components healthy, instance is ready.',
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'One or more required components are down.',
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Get('health/ready')
  async getReadiness(
    @Res() res: Response,
  ): Promise<Response<ReadinessResponseDto>> {
    return this.runReadinessCheck(res);
  }

  /**
   * Legacy health check endpoint preserved for backwards compatibility.
   * Behaves identically to GET /health/ready (readiness semantics) so any
   * existing monitors that poll /health keep working unchanged. New
   * deployments should prefer /health/live for the liveness probe and
   * /health/ready for the readiness / load-balancer probe.
   *
   * @param res - Express response object
   * @returns Same payload and status code as /health/ready
   * @authentication None (public endpoint)
   * @deprecated Prefer GET /health/live (liveness) and GET /health/ready (readiness).
   */
  @ApiOperation({
    summary:
      'Legacy health check — identical to /health/ready (readiness semantics). Kept for backwards compatibility.',
  })
  @ApiOkResponse({
    description: 'All required components healthy.',
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'One or more required components are down.',
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: 200, description: 'All components healthy.' })
  @ApiResponse({ status: 503, description: 'One or more components are down.' })
  @SkipThrottle({ public: true }) // Health checks should never be throttled.
  @Get('health')
  async getHealth(
    @Res() res: Response,
  ): Promise<Response<ReadinessResponseDto>> {
    return this.runReadinessCheck(res);
  }

  /**
   * Returns the application version and environment information.
   *
   * @returns Version string, package name, and current environment
   * @authentication None (public endpoint)
   */
  @ApiOperation({ summary: 'Get current application version and environment' })
  @ApiOkResponse({ description: 'Version information returned.' })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Get('version')
  @HttpCode(HttpStatus.OK)
  getVersion() {
    return {
      version: getAppVersion(),
      name: '@truestlink/trustlink-backend',
      environment: this.configService.get('NODE_ENV'),
    };
  }

  /**
   * Shared implementation used by both GET /health and GET /health/ready.
   * Runs the three dependency checks concurrently, composes the response
   * body, and returns 200/503 based on the combined status of required
   * components only (Redis is optional).
   */
  private async runReadinessCheck(
    res: Response,
  ): Promise<Response<ReadinessResponseDto>> {
    const start = Date.now();
    const checks = await this.checkAllDependencies();

    const redisStatus: OptionalComponentStatus =
      'rawStatus' in checks.redis && checks.redis.rawStatus === 'disabled'
        ? 'disabled'
        : checks.redis.status === 'ok'
          ? 'ok'
          : 'down';

    const allOk = checks.db.status === 'ok' && checks.horizon.status === 'ok';

    if (!allOk) {
      this.logger.warn(
        `Readiness check failed: db=${checks.db.status}, horizon=${checks.horizon.status}, redis=${redisStatus}`,
      );
    }

    const body: ReadinessResponseDto = {
      status: allOk ? 'ok' : 'down',
      db: checks.db.status,
      horizon: checks.horizon.status,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
      environment: this.configService.get('NODE_ENV'),
      version: getAppVersion(),
      durationMs: Date.now() - start,
    };

    if (!allOk) {
      body.details = {};
      if (checks.db.status === 'down') {
        body.details.db = { status: 'down', error: checks.db.error };
      }
      if (checks.horizon.status === 'down') {
        body.details.horizon = {
          status: 'down',
          error: checks.horizon.error,
        };
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
  @Throttle({ public: { limit: 100, ttl: 60000 } })
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
      const message =
        err instanceof Error ? err.message : 'Database connection failed';
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
      const message =
        err instanceof Error ? err.message : 'Horizon connection failed';
      this.logger.error(`Horizon health check failed: ${message}`);
      return { status: 'down', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkRedis(): Promise<
    ComponentHealth & { rawStatus?: string }
  > {
    const result = await this.cacheService.ping();
    if (result === 'ok') {
      return { status: 'ok' };
    }
    const error =
      result === 'disabled'
        ? 'Redis not configured'
        : 'Redis connection failed';
    return { status: 'down', error, rawStatus: result };
  }
}
