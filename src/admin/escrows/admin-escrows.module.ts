import { Module } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { EscrowModule } from '../../escrow/escrow.module';
import { AdminGuard } from '../guards/admin.guard';
import { AdminEscrowsController } from './admin-escrows.controller';
import { AdminEscrowsService } from './admin-escrows.service';

@Module({
  imports: [EscrowModule],
  controllers: [AdminEscrowsController],
  providers: [AdminEscrowsService, AdminGuard, JwtGuard],
})
export class AdminEscrowsModule {}
