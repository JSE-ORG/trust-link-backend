import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DisputeModule } from '../dispute/dispute.module';
import { EscrowModule } from '../escrow/escrow.module';
import { StellarModule } from '../stellar/stellar.module';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';

@Module({
  imports: [PrismaModule, DisputeModule, EscrowModule, StellarModule],
  providers: [AdminService, AdminGuard],
  exports: [AdminService, AdminGuard],
})
export class AdminModule {}
