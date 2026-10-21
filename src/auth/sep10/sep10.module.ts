import { Module } from '@nestjs/common';
import { Sep10Controller } from './sep10.controller';
import { Sep10Service } from './sep10.service';
import { NonceCleanupService } from './nonce-cleanup.service';
import { RefreshTokenCleanupService } from './refresh-token-cleanup.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NonceRepository } from './nonce.repository';
import { RefreshTokenRepository } from './refresh-token.repository';

@Module({
  imports: [PrismaModule],
  controllers: [Sep10Controller],
  providers: [
    Sep10Service,
    NonceCleanupService,
    NonceRepository,
    RefreshTokenCleanupService,
    RefreshTokenRepository,
  ],
  exports: [Sep10Service],
})
export class Sep10Module {}
