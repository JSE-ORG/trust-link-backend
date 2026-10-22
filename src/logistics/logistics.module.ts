import { Global, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';
import { GiglClient } from './gigl/gigl.client';
import { LogisticsService } from './logistics.service';
import { ProviderCredentialRepository } from './provider-credential.repository';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    ProviderCredentialRepository,
    GiglLogisticsService,
    {
      provide: LogisticsService,
      useExisting: GiglLogisticsService,
    },
    {
      provide: GiglClient,
      useFactory: (config: ConfigService, moduleRef: ModuleRef) => {
        const baseUrl = config.get<string>('LOGISTICS_API_BASE_URL');

        if (!baseUrl) {
          return null;
        }

        // Read the key dynamically so rotations via rotateApiKey() take effect
        // immediately without a process restart (issue #1054). The service is
        // resolved at call time because it depends on this client itself.
        return new GiglClient({
          baseUrl,
          getApiToken: () =>
            moduleRef.get(GiglLogisticsService, { strict: false }).getApiKey(),
        });
      },
      inject: [ConfigService, ModuleRef],
    },
  ],
  exports: [GiglClient, GiglLogisticsService, LogisticsService],
})
export class LogisticsModule {}
