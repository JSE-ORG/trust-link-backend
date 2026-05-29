import { Module } from '@nestjs/common';
import { AdminGuard } from '../guards/admin.guard';
import { ApiKeysController } from './api-keys.controller';

@Module({
  controllers: [ApiKeysController],
  providers: [AdminGuard],
})
export class ApiKeysModule {}
