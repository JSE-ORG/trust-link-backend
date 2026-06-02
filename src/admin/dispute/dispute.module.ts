import { Module } from '@nestjs/common';
import { AuditLogModule } from '../../audit-log/audit-log.module';
import { AdminModule } from '../admin.module';
import { DisputeController } from './dispute.controller';

@Module({
  imports: [AdminModule, AuditLogModule],
  controllers: [DisputeController],
})
export class DisputeModule {}
