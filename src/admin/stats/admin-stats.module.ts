import { Module } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

@Module({
  controllers: [AdminStatsController],
  providers: [AdminStatsService, AdminGuard, JwtGuard],
})
export class AdminStatsModule {}
