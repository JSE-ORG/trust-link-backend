import { Module } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { QueueDashboardController } from './queue-dashboard.controller';
import { QueueDashboardService } from './queue-dashboard.service';

/**
 * Issue #75 – Queue dashboard module.
 *
 * Exposes GET /admin/queues behind admin authentication.
 * When BullMQ is added as a dependency, register BullModule here and inject
 * real Queue instances into QueueDashboardService.
 */
@Module({
  controllers: [QueueDashboardController],
  providers: [QueueDashboardService, AdminGuard, JwtGuard],
})
export class QueueDashboardModule {}
