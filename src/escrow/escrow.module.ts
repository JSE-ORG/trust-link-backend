import { Module } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowController } from './escrow.controller';
import { VendorEscrowController } from './vendor-escrow.controller';
import { EscrowRepository } from './escrow.repository';
import { EscrowService } from './escrow.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [EscrowController, VendorEscrowController],
  providers: [EscrowService, EscrowRepository, JwtGuard],
  exports: [EscrowService, EscrowRepository],
})
export class EscrowModule {}
