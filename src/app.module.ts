import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Sep10Module } from './auth/sep10/sep10.module';
import { DisputeModule } from './admin/dispute/dispute.module';
import { EscrowModule } from './escrow/escrow.module';
import { PrismaModule } from './prisma/prisma.module';
import { StellarModule } from './stellar/stellar.module';
import { VendorModule } from './vendor/vendor.module';

@Module({
  imports: [PrismaModule, EscrowModule, StellarModule, Sep10Module, DisputeModule, VendorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
