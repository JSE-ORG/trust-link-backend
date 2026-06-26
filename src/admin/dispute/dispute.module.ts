import { Module } from '@nestjs/common';
import { AuditLogModule } from '../../audit-log/audit-log.module';
import { EscrowModule } from '../../escrow/escrow.module';
import { StellarModule } from '../../stellar/stellar.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminGuard } from '../guards/admin.guard';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

@Module({
  imports: [EscrowModule, StellarModule, AuditLogModule, PrismaModule],
  controllers: [DisputeController],
  providers: [DisputeService, AdminGuard],
})
export class DisputeModule {}
