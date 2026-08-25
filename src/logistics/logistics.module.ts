import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';
import { GiglClient } from './gigl/gigl.client';
import { LogisticsService } from './logistics.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: GiglClient,
      useFactory: (config: ConfigService) => {
        const baseUrl = config.get<string>('LOGISTICS_API_BASE_URL');
        const apiToken = config.get<string>('LOGISTICS_API_KEY');

        if (!baseUrl || !apiToken) {
          return null;
        }

        return new GiglClient({ baseUrl, apiToken });
      },
      inject: [ConfigService],
    },
    GiglLogisticsService,
    {
      provide: LogisticsService,
      useExisting: GiglLogisticsService,
    },
  ],
  exports: [GiglClient, GiglLogisticsService, LogisticsService],
})
export class LogisticsModule {}
