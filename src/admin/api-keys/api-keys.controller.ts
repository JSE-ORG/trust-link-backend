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
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { LogisticsService } from '../../logistics/logistics.service';
import { RotateApiKeyDto } from './dto/rotate-api-key.dto';
import { reencryptCredential } from '../../common/sanitization/credential-encryption.util';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/credentials')
@UseGuards(JwtGuard, AdminGuard)
export class ApiKeysController {
  constructor(private readonly logisticsService: LogisticsService) {}

  @ApiOperation({
    summary: 'Rotate the logistics provider API key (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Logistics API key updated successfully.',
  })
  @ApiResponse({ status: 400, description: 'Invalid key payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @Patch('logistics')
  @HttpCode(HttpStatus.OK)
  rotateLogisticsKey(@Body() dto: RotateApiKeyDto) {
    const currentEncryptedKey = this.logisticsService.getEncryptedApiKey();
    let newEncryptedKey: string;

    if (currentEncryptedKey) {
      // Re-encrypt with current key (key rotation)
      newEncryptedKey = reencryptCredential(currentEncryptedKey);
    } else {
      // This is a new key being set (first time)
      // The setApiKey method will encrypt it
      this.logisticsService.setApiKey(dto.key);
      newEncryptedKey = this.logisticsService.getEncryptedApiKey()!;
    }

    this.logisticsService.setEncryptedApiKey(newEncryptedKey);
    return { message: 'Logistics API key updated and encrypted' };
  }
}
