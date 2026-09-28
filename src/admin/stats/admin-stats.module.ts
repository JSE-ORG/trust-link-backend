import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsRepository } from './admin-stats.repository';
import { AdminStatsService } from './admin-stats.service';

@Module({
  // Issue #846: the dashboard aggregates come from the repository.
  imports: [PrismaModule],
  controllers: [AdminStatsController],
  providers: [AdminStatsService, AdminStatsRepository, AdminGuard, JwtGuard],
})
export class AdminStatsModule {}
