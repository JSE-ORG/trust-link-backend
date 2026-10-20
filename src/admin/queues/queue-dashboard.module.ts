import { Module } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { QueueDashboardController } from './queue-dashboard.controller';
import { QueueDashboardService } from './queue-dashboard.service';
import { ConfigModule } from '../../config/config.module';

@Module({
  imports: [ConfigModule],
  controllers: [QueueDashboardController],
  providers: [QueueDashboardService, AdminGuard, JwtGuard],
})
export class QueueDashboardModule {}
