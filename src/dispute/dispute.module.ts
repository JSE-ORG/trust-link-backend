import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DisputeRepository } from './dispute.repository';

@Module({
  imports: [PrismaModule],
  providers: [DisputeRepository],
  exports: [DisputeRepository],
})
export class DisputeModule {}
