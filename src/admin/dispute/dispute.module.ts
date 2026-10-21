import { Module } from '@nestjs/common';
import { AuditLogModule } from '../../audit-log/audit-log.module';
import { EscrowModule } from '../../escrow/escrow.module';
import { StellarModule } from '../../stellar/stellar.module';
import { DisputeModule as CoreDisputeModule } from '../../dispute/dispute.module';
import { AdminGuard } from '../guards/admin.guard';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [EscrowModule, StellarModule, AuditLogModule, CoreDisputeModule, NotificationsModule],
  controllers: [DisputeController],
  providers: [DisputeService, AdminGuard],
})
export class DisputeModule {}
