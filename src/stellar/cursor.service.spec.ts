import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CursorService } from './cursor.service';
import { CursorRepository } from './cursor.repository';

describe('CursorService', () => {
  let service: CursorService;
  let repositoryMock: { findById: jest.Mock; upsert: jest.Mock };

  beforeEach(async () => {
    repositoryMock = {
      findById: jest.fn(),
      upsert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CursorService,
        { provide: CursorRepository, useValue: repositoryMock },
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
      repositoryMock.findById.mockResolvedValue({
        id: 'stellar-listener',
        cursorValue: '12345',
      });

      const result = await service.get();
      expect(result).toBe('12345');
      expect(repositoryMock.findById).toHaveBeenCalledWith('stellar-listener');
    });

    it('should return undefined when no cursor exists', async () => {
      repositoryMock.findById.mockResolvedValue(null);

      const result = await service.get();
      expect(result).toBeUndefined();
    });

    it('should log a warning and return undefined on Prisma error', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      repositoryMock.findById.mockRejectedValue(new Error('DB error'));

      const result = await service.get();

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to read cursor from DB: DB error',
      );
    });
  });

  describe('set', () => {
    it('should upsert cursor value', async () => {
      repositoryMock.upsert.mockResolvedValue(undefined);

      await service.set('67890');
      expect(repositoryMock.upsert).toHaveBeenCalledWith(
        'stellar-listener',
        '67890',
      );
    });

    it('should log a warning and not rethrow on Prisma error', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      repositoryMock.upsert.mockRejectedValue(new Error('DB error'));

      await expect(service.set('67890')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to persist cursor to DB: DB error',
      );
    });
  });
});
