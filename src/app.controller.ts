import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';
import { getAppVersion } from './common/version';
import { ConfigService } from './config/config.service';
import { PrismaService } from './prisma/prisma.service';

type ComponentStatus = 'ok' | 'down';

interface HealthBody {
  status: ComponentStatus;
  db: ComponentStatus;
  horizon: ComponentStatus;
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

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(@Res() res: Response): Promise<Response<HealthBody>> {
    const start = Date.now();

    const [db, horizon] = await Promise.all([
      this.checkDatabase(),
      this.checkHorizon(),
    ]);

    const allOk = db === 'ok' && horizon === 'ok';

    const body: HealthBody = {
      status: allOk ? 'ok' : 'down',
      db,
      horizon,
      timestamp: new Date().toISOString(),
      environment: this.configService.get('NODE_ENV'),
      version: getAppVersion(),
      durationMs: Date.now() - start,
    };

    return res
      .status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(body);
  }

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
