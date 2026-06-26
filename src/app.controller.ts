import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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

interface HealthBody {
  status: ComponentStatus;
  db: ComponentStatus;
  horizon: ComponentStatus;
  redis: OptionalComponentStatus;
  timestamp: string;
  environment: string;
  version: string;
  durationMs: number;
}

const HORIZON_URLS: Record<'TESTNET' | 'MAINNET', string> = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
};

const HORIZON_TIMEOUT_MS = 150;

@ApiTags('Health')
@Controller()
export class AppController {
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

  @ApiOperation({ summary: 'Service health check — database, Horizon, and Redis' })
  @ApiResponse({ status: 200, description: 'All components healthy.' })
  @ApiResponse({ status: 503, description: 'One or more components are down.' })
  @Get('health')
  async getHealth(@Res() res: Response): Promise<Response<HealthBody>> {
    const start = Date.now();

    const [db, horizon, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkHorizon(),
      this.cacheService.ping(),
    ]);

    // Redis is optional: a 'disabled' or 'down' Redis is reported but does not
    // flip the overall status to unhealthy (graceful fallback — issue #31).
    const allOk = db === 'ok' && horizon === 'ok';

    const body: HealthBody = {
      status: allOk ? 'ok' : 'down',
      db,
      horizon,
      redis,
      timestamp: new Date().toISOString(),
      environment: this.configService.get('NODE_ENV'),
      version: getAppVersion(),
      durationMs: Date.now() - start,
    };

    return res
      .status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(body);
  }

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

  private async checkDatabase(): Promise<ComponentStatus> {
    try {
      await this.prismaService.escrow.findMany({});
      return 'ok';
    } catch {
      return 'down';
    }
  }

  private async checkHorizon(): Promise<ComponentStatus> {
    const network = this.configService.get('STELLAR_NETWORK');
    const horizonUrl = HORIZON_URLS[network];
    if (!horizonUrl) {
      return 'down';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HORIZON_TIMEOUT_MS);

    try {
      const response = await fetch(horizonUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok ? 'ok' : 'down';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timeout);
    }
  }
}
