import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminStatsModule } from './admin/stats/admin-stats.module';
import { DisputeModule as AdminDisputeModule } from './admin/dispute/dispute.module';
import { QueueDashboardModule } from './admin/queues/queue-dashboard.module';
import { ApiKeysModule } from './admin/api-keys/api-keys.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { LogisticsModule } from './logistics/logistics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Sep10Module } from './auth/sep10/sep10.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { LoggerModule } from './common/logger/logger.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { CacheModule } from './cache/cache.module';
import { ConfigModule } from './config/config.module';
import { EscrowModule } from './escrow/escrow.module';
import { PrismaModule } from './prisma/prisma.module';
import { StellarModule } from './stellar/stellar.module';
import { VendorModule } from './vendor/vendor.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { StressTestModule } from './stress-test/stress-test.module';
import { CacheService } from './common/cache.service';

@Module({
  imports: [
    // Core infrastructure
    ConfigModule,
    PrismaModule,
    LoggerModule,
    CacheModule,
    LogisticsModule,
    AuditLogModule,

    // Auth
    Sep10Module,

    // Feature modules
    EscrowModule,
    StellarModule,
    VendorModule,

    // Admin modules
    AdminStatsModule,
    AdminDisputeModule,
    QueueDashboardModule, // issue #75 – BullMQ dashboard at GET /admin/queues
    ApiKeysModule,

    // Webhook receivers
    WebhooksModule, // issue #76 – POST /webhooks/stellar
    StressTestModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    CacheService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityMiddleware, LoggerMiddleware).forRoutes('*');
  }
}
