import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../../common/security/throttle.config';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { LogisticsService } from '../../logistics/logistics.service';
import { RotateApiKeyDto } from './dto/rotate-api-key.dto';
import { RotateApiKeyResponseDto } from './dto/rotate-api-key-response.dto';
import { AuditLogService } from '../../audit-log/audit-log.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/credentials')
@UseGuards(JwtGuard, AdminGuard)
export class ApiKeysController {
  constructor(
    private readonly logisticsService: LogisticsService,
    private readonly auditLog?: AuditLogService,
  ) {}

  /**
   * Rotates the logistics provider API key and stores it encrypted.
   *
   * @param dto DTO containing the new API key.
   * @param admin Authenticated admin user performing the rotation.
   * @returns Success response confirming the key update.
   * @throws BadRequestException if the request payload is invalid.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
  @ApiOperation({
    summary: 'Rotate the logistics provider API key (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Logistics API key updated successfully.',
    type: RotateApiKeyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid key payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 5, ttl: THROTTLE_WINDOW_MS } })
  @Patch('logistics')
  @HttpCode(HttpStatus.OK)
  async rotateLogisticsKey(
    @Body() dto: RotateApiKeyDto,
    @CurrentUser() admin?: AuthUser,
  ) {
    // Always rotate to the submitted key, whether or not one was already set
    // (issue #498), and persist it outside process memory (issue #499).
    await this.logisticsService.rotateApiKey(dto.key);

    // Issue #954 / #1051: Audit credential rotation (provider name only, never the key)
    const adminAddress = admin?.address ?? 'unknown';
    if (this.auditLog) {
      await this.auditLog.append({
        action: 'CREDENTIAL_ROTATED',
        adminAddress,
        entityType: 'logistics_provider',
        entityId: 'logistics',
        details: {
          provider: 'logistics',
        },
      });
    }

    return { message: 'Logistics API key updated and encrypted' };
  }
}
