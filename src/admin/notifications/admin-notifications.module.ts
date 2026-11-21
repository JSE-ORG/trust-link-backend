import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationRepository } from '../../notifications/notification.repository';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminGuard } from '../guards/admin.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AdminNotificationsController],
  providers: [NotificationRepository, AdminGuard],
})
export class AdminNotificationsModule {}
