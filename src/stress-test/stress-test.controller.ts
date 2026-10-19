import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../common/security/throttle.config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { StressTestService } from './stress-test.service';
import { StressTestConfigDto } from './dto/stress-test-config.dto';
import { StressTestResult } from './interfaces/stress-test-result.interface';
import { StressTestResultDto } from './dto/stress-test-result.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

@ApiTags('Stress Test')
@ApiBearerAuth()
@Controller('stress-test')
@UseGuards(JwtGuard, AdminGuard)
export class StressTestController {
  private readonly logger = new Logger(StressTestController.name);

  constructor(
    private readonly stressTestService: StressTestService,
    private readonly auditLog: AuditLogService,
  ) {}

  @ApiOperation({ summary: 'Start a new stress test run' })
  @ApiResponse({
    status: 200,
    description: 'Stress test execution started.',
    type: StressTestResultDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid stress test configuration.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Throttle({ default: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  @Post()
  async runStressTest(
    @Body() config: StressTestConfigDto,
    @CurrentUser() admin?: AuthUser,
  ): Promise<StressTestResult> {
    this.logger.log(`Received stress test request: ${config.testName}`);
    const result = await this.stressTestService.runStressTest(config);

    // Issue #954: Audit stress test execution
    const adminAddress = admin?.address ?? 'unknown';
    await this.auditLog.append({
      action: 'STRESS_TEST_STARTED',
      adminAddress,
      entityType: 'stress_test',
      entityId: config.testName || 'unnamed',
      details: {
        testName: config.testName,
        profileCount: config.profileCount || 0,
      },
    });

    return result;
  }

  @ApiOperation({ summary: 'Get the status of a single active stress test' })
  @ApiResponse({
    status: 200,
    description: 'Active stress test status returned.',
    type: StressTestResultDto,
  })
  @ApiResponse({ status: 404, description: 'Stress test not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiParam({ name: 'testId', example: 'stress-test-2026-07-29' })
  @Throttle({ default: { limit: 30, ttl: THROTTLE_WINDOW_MS } })
  @Get('active/:testId')
  getActiveTest(@Param('testId') testId: string): StressTestResult {
    const result = this.stressTestService.getActiveTest(testId);
    if (!result) {
      throw new NotFoundException(`Stress test with id "${testId}" not found`);
    }
    return result;
  }

  @ApiOperation({ summary: 'List all currently active stress tests' })
  @ApiResponse({
    status: 200,
    description: 'Active stress tests returned.',
    type: [StressTestResultDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Throttle({ default: { limit: 30, ttl: THROTTLE_WINDOW_MS } })
  @Get('active')
  getAllActiveTests(): StressTestResult[] {
    return this.stressTestService.getAllActiveTests();
  }
}
