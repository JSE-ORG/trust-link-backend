import { Global, Module } from '@nestjs/common';
import { wrapPrismaWithTracing } from '../tracing/prisma-tracing.wrapper';
import { TracingService } from '../tracing/tracing.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from './prisma.service';

// Connection-pool tuning is controlled via two optional env vars:
//   DB_POOL_CONNECTION_LIMIT  – max simultaneous Prisma connections (default: 10)
//   DB_POOL_TIMEOUT_MS        – ms to wait for a free connection before error (default: 10000)
//
// ConfigService.getDatabaseUrl() appends these as `connection_limit` and
// `pool_timeout` query parameters on the PostgreSQL connection string so Prisma
// picks them up without any code-level PrismaClient construction.

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: (tracing: TracingService, config: ConfigService) => {
        const prisma = new PrismaService(config.getDatabaseUrl());
        return tracing.isEnabled()
          ? wrapPrismaWithTracing(prisma, tracing)
          : prisma;
      },
      inject: [TracingService, ConfigService],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
