import { Test, TestingModule } from '@nestjs/testing';
import { CursorService } from './cursor.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CursorService', () => {
  let service: CursorService;
  let prismaMock: {
    cursor: {
      findFirst: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prismaMock = {
      cursor: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CursorService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(CursorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return cursor value when found', async () => {
      prismaMock.cursor.findFirst.mockResolvedValue({
        id: 'stellar-listener',
        cursorValue: '12345',
      });

      const result = await service.get();
      expect(result).toBe('12345');
      expect(prismaMock.cursor.findFirst).toHaveBeenCalledWith({
        where: { id: 'stellar-listener' },
      });
    });

    it('should return undefined when no cursor exists', async () => {
      prismaMock.cursor.findFirst.mockResolvedValue(null);

      const result = await service.get();
      expect(result).toBeUndefined();
    });

    it('should return undefined on error', async () => {
      prismaMock.cursor.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.get();
      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should upsert cursor value', async () => {
      prismaMock.cursor.upsert.mockResolvedValue({});

      await service.set('67890');
      expect(prismaMock.cursor.upsert).toHaveBeenCalledWith({
        where: { id: 'stellar-listener' },
        update: { cursorValue: '67890' },
        create: { id: 'stellar-listener', cursorValue: '67890' },
      });
    });

    it('should not throw on error', async () => {
      prismaMock.cursor.upsert.mockRejectedValue(new Error('DB error'));

      await expect(service.set('67890')).resolves.toBeUndefined();
    });
  });
});
