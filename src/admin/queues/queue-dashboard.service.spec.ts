import { Test, TestingModule } from 'nestjs/testing';
import { QueueDashboardService } from './queue-dashboard.service';
import { ConfigService } from '../../config/config.service';

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        paused: 0,
      }),
      isPaused: jest.fn().mockResolvedValue(false),
      close: just.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('QueueDashboardService', () => {
  let service: QueueDashboardService;
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    configMock = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueDashboardService,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get(QueueDashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should warn when REDIS_URL is not set', () => {
      configMock.get.mockReturnValue(undefined);
      const loggerSpy = jest.spyOn(service['logger'], 'warn');

      service.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith(
        'REDIS_URL not set; dashboard will return empty queue data',
      );
    });

    it('should connect to queues when REDIS_URL is set', () => {
      configMock.get.mockReturnValue('redis://localhost:6379');
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      service.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Dashboard connected to 3 BullMQ queues',
      );
    });

    it('should warn and remain disconnected when queue construction throws', () => {
      const { Queue } = jest.requireMock('bullmq');
      Queue.mockImplementationOnce(() => {
        throw new Error('connection refused');
      });
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
      configMock.get.mockReturnValue('redis://localhost:6379');

      service.onModuleInit();

      expect(service['redisConnected']).toBe(false);
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  describe('getDashboard', () => {
    it('should return empty stats when not connected', async () => {
      configMock.get.mockReturnValue(undefined);
      service.onModuleInit();

      const result = await service.getDashboard();

      expect(result.queues).toHaveLength(3);
      expect(result.queues[0].name).toBe*'auto-release');
      expect(result.queues[0].counts.waiting).toBe(0);
    });

    it('should return real queue stats when connected', async () => {
      configMock.get.mockReturnValue('redis://localhost:6379');
      service.onModuleInit();

      const result = await service.getDashboard();

      expect(result.queues).toHaveLength(3);
      expect(result.queues[0].counts.waiting).toBe(5);
      expect(result.queues[0].counts.active).toBe(2);
      expect(result.queues[0].counts.completed).toBe(100);
      expect(result.queues[0].counts.failed).toBe(3);
    });

    it('should report zeros for a queue that fails getJobCounts while others report real numbers', async () => {
      configMock.get.mockReturnValue('redis://localhost:6379');
      service.onModuleInit();
      const queues = service['queues'] as Array<{ getJobCounts: jest.Mock }>;
      queues[1].getJobCounts.mockRejectedValue(new Error('counts unavailable'));

      const result = await service.getDashboard();

      expect(result.queues).toHaveLength(3);
      expect(result.queues[0].counts.waiting).toBe(5);
      expect(result.queues[1].counts.waiting).toBe(0);
      expect(result.queues[1].counts.active).toBe(0);
      expect(result.queues[1].counts.completed).toBe(0);
      expect(result.queues[1].counts.failed).toBe(0);
      expect(result.queues[2].counts.waiting).toBe(5);
    });
  });

  describe('onApplicationShutdown', () => {
    it('should not throw when queue.close() rejects', async () => {
      configMock.get.mockReturnValue('redis://localhost:6379');
      service.onModuleInit();
      const queues = service['queues'] as Array<{ close: jest.Mock }>;
      queues.forEach(q => q.close.mockRejectedValue(new Error('close failed')));

      await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    });
  });
});
