import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from './audit-log.service';
import { AuditLogRepository } from './audit-log.repository';

@Global()
@Module({
  // Issue #846: AuditLogService now depends on the repository, which is the
  // only part of this module that touches PrismaService.
  imports: [PrismaModule],
  providers: [AuditLogService, AuditLogRepository],
  exports: [AuditLogService, AuditLogRepository],
})
export class AuditLogModule {}
