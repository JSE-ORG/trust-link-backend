import { Module } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminModule } from '../admin.module';
import { AdminStatsController } from './admin-stats.controller';

@Module({
  imports: [AdminModule],
  controllers: [AdminStatsController],
  providers: [JwtGuard],
})
export class AdminStatsModule {}
