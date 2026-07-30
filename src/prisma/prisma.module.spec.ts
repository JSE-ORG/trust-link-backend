import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';
import { TracingModule } from '../tracing/tracing.module';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { TracingService } from '../tracing/tracing.service';

describe('PrismaModule', () => {
  let mockTracing: jest.Mocked<TracingService>;
  let mockConfig: Partial<ConfigService>;

  beforeEach(() => {
    mockTracing = {
      isEnabled: jest.fn(),
    } as unknown as jest.Mocked<TracingService>;

    mockConfig = {
      getDatabaseUrl: jest.fn().mockReturnValue('postgresql://localhost/test'),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('constructs PrismaService without wrapping when tracing is disabled', async () => {
    mockTracing.isEnabled.mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, TracingModule, ConfigModule],
    })
      .overrideProvider(TracingService)
      .useValue(mockTracing)
      .overrideProvider(ConfigService)
      .useValue(mockConfig)
      .compile();

    const prisma = module.get(PrismaService);
    expect(prisma).toBeInstanceOf(PrismaService);
    expect(mockTracing.isEnabled).toHaveBeenCalled();
  });

  it('returns wrapped PrismaService when tracing is enabled', async () => {
    mockTracing.isEnabled.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, TracingModule, ConfigModule],
    })
      .overrideProvider(TracingService)
      .useValue(mockTracing)
      .overrideProvider(ConfigService)
      .useValue(mockConfig)
      .compile();

    const prisma = module.get(PrismaService);
    expect(prisma).toBeDefined();
    expect(mockTracing.isEnabled).toHaveBeenCalled();
  });
});
