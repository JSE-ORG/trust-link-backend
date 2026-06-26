import { Controller, Post, Body, Get, Param, Logger } from '@nestjs/common';
import { StressTestService } from './stress-test.service';
import { StressTestConfigDto } from './dto/stress-test-config.dto';
import { StressTestResult } from './interfaces/stress-test-result.interface';

@Controller('stress-test')
export class StressTestController {
  private readonly logger = new Logger(StressTestController.name);

  constructor(private readonly stressTestService: StressTestService) {}

  @Post()
  async runStressTest(
    @Body() config: StressTestConfigDto,
  ): Promise<StressTestResult> {
    this.logger.log(`Received stress test request: ${config.testName}`);
    return await this.stressTestService.runStressTest(config);
  }

  @Get('active/:testId')
  getActiveTest(@Param('testId') testId: string): StressTestResult | undefined {
    return this.stressTestService.getActiveTest(testId);
  }

  @Get('active')
  getAllActiveTests(): StressTestResult[] {
    return this.stressTestService.getAllActiveTests();
  }
}
