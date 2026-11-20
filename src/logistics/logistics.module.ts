import { Global, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { GiglLogisticsService } from './gigl/gigl-logistics.service';
import { GiglClient } from './gigl/gigl.client';
import { LogisticsService } from './logistics.service';
import { ProviderCredentialRepository } from './provider-credential.repository';
import { TerminalAfricaClient } from './terminal-africa/terminal-africa.client';
import { TerminalAfricaLogisticsService } from './terminal-africa/terminal-africa-logistics.service';

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
    TerminalAfricaLogisticsService,
    {
      provide: TerminalAfricaClient,
      useFactory: (config: ConfigService) => {
        const baseUrl = config.get<string>('TERMINAL_AFRICA_API_BASE_URL');
        const apiKey = config.get<string>('TERMINAL_AFRICA_API_KEY');
        return baseUrl && apiKey
          ? new TerminalAfricaClient({ baseUrl, apiKey })
          : null;
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    GiglClient,
    GiglLogisticsService,
    LogisticsService,
    TerminalAfricaLogisticsService,
  ],
})
export class LogisticsModule {}
