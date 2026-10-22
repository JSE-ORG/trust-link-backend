import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService.getDailyVolumeChart timezone window (#1063)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    {
      timezone: 'America/Los_Angeles',
      now: '2026-10-19T17:00:00.000Z',
      start: '2026-10-13T07:00:00.000Z',
    },
    {
      timezone: 'Africa/Lagos',
      now: '2026-10-18T23:30:00.000Z',
      start: '2026-10-12T23:00:00.000Z',
    },
    {
      timezone: 'UTC',
      now: '2026-10-19T12:00:00.000Z',
      start: '2026-10-13T00:00:00.000Z',
    },
  ])(
    'returns seven whole local days ending today in $timezone',
    async ({ timezone, now, start }) => {
      const fixedNow = new Date(now);
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);

      const aggregateDailyVolume = jest.fn().mockResolvedValue([]);
      const service = new AnalyticsService({
        aggregateDailyVolume,
      } as unknown as AnalyticsRepository);

      const result = await service.getDailyVolumeChart(
        'vendor-address',
        7,
        timezone,
      );

      expect(result.data.map(({ date }) => date)).toEqual([
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
        '2026-10-18',
        '2026-10-19',
      ]);
      expect(result.period).toEqual({
        startDate: '2026-10-13',
        endDate: '2026-10-19',
      });
      expect(aggregateDailyVolume).toHaveBeenCalledWith(
        'vendor-address',
        new Date(start),
        fixedNow,
        timezone,
      );
    },
  );
});
