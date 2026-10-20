import { forwardRef, Module } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DisputeModule } from '../dispute/dispute.module';
import { StellarModule } from '../stellar/stellar.module';
import { S3PresignService } from '../common/services/s3-presign.service';
import { EscrowController } from './escrow.controller';
import { VendorEscrowController } from './vendor-escrow.controller';
import { EscrowRepository } from './escrow.repository';
import { EscrowService } from './escrow.service';
import { BuyerDisputeService } from './buyer-dispute.service';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    DisputeModule,
    forwardRef(() => StellarModule),
  ],
  controllers: [EscrowController, VendorEscrowController],
  providers: [
    EscrowService,
    EscrowRepository,
    BuyerDisputeService,
    S3PresignService,
    JwtGuard,
  ],
  exports: [EscrowService, EscrowRepository],
})
export class EscrowModule {}
