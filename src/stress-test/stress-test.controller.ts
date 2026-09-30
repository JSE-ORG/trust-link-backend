import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../common/security/throttle.config';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { StressTestService } from './stress-test.service';
import { StressTestConfigDto } from './dto/stress-test-config.dto';
import { StressTestResult } from './interfaces/stress-test-result.interface';
import { StressTestResultDto } from './dto/stress-test-result.dto';

@ApiTags('Stress Test')
@Controller('stress-test')
@UseGuards(JwtGuard, AdminGuard)
export class StressTestController {
  private readonly logger = new Logger(StressTestController.name);

  constructor(private readonly stressTestService: StressTestService) {}

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
  @Throttle({ default: { limit: 10, ttl: THROTTLE_WINDOW_MS } })
  @Post()
  async runStressTest(
    @Body() config: StressTestConfigDto,
  ): Promise<StressTestResult> {
    this.logger.log(`Received stress test request: ${config.testName}`);
    return await this.stressTestService.runStressTest(config);
  }

  @ApiOperation({ summary: 'Get the status of a single active stress test' })
  @ApiResponse({
    status: 200,
    description: 'Active stress test status returned.',
    type: StressTestResultDto,
  })
  @ApiResponse({ status: 404, description: 'Stress test not found.' })
  @ApiParam({ name: 'testId', example: 'stress-test-2026-07-29' })
  @Throttle({ default: { limit: 30, ttl: THROTTLE_WINDOW_MS } })
  @Get('active/:testId')
  getActiveTest(@Param('testId') testId: string): StressTestResult | undefined {
    return this.stressTestService.getActiveTest(testId);
  }

  @ApiOperation({ summary: 'List all currently active stress tests' })
  @ApiResponse({
    status: 200,
    description: 'Active stress tests returned.',
    type: [StressTestResultDto],
  })
  @Throttle({ default: { limit: 30, ttl: THROTTLE_WINDOW_MS } })
  @Get('active')
  getAllActiveTests(): StressTestResult[] {
    return this.stressTestService.getAllActiveTests();
  }
}
