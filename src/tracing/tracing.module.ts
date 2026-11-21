import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TracingInterceptor } from './tracing.interceptor';
import { TracingService } from './tracing.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [
    TracingService,
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [TracingService, MetricsService],
})
export class TracingModule {}
