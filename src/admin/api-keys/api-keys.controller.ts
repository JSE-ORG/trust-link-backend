import { Body, Controller, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { LogisticsService } from '../../logistics/logistics.service';
import { RotateApiKeyDto } from './dto/rotate-api-key.dto';

@Controller('admin/credentials')
@UseGuards(JwtGuard, AdminGuard)
export class ApiKeysController {
  constructor(private readonly logisticsService: LogisticsService) {}

  /**
   * Rotates the logistics provider API key. The updated key takes effect
   * immediately for all subsequent calls, including background workers,
   * without requiring a service restart.
   */
  @Patch('logistics')
  @HttpCode(HttpStatus.OK)
  rotateLogisticsKey(@Body() dto: RotateApiKeyDto) {
    this.logisticsService.setApiKey(dto.key);
    return { message: 'Logistics API key updated' };
  }
}
