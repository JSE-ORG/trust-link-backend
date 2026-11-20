import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './analytics.repository';

describe('AnalyticsService timezone window boundaries (#1109)', () => {
  const originalTime = new Date('2026-11-20T12:00:00.000Z');
  let aggregateDailyVolume: jest.Mock;
  let service: AnalyticsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(originalTime);
    aggregateDailyVolume = jest.fn().mockResolvedValue([]);
    service = new AnalyticsService({
      aggregateDailyVolume,
    } as unknown as AnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['America/New_York', '2026-11-19T05:00:00.000Z'],
    ['Asia/Tokyo', '2026-11-18T15:00:00.000Z'],
  ])('starts at local midnight for %s', async (timezone, expectedStart) => {
    const result = await service.getDailyVolumeChart('vendor', 2, timezone);

    expect(aggregateDailyVolume).toHaveBeenCalledWith(
      'vendor',
      new Date(expectedStart),
      new Date('2026-11-20T12:00:00.000Z'),
      timezone,
    );
    expect(result.period).toEqual({
      startDate: '2026-11-19',
      endDate: '2026-11-20',
    });
    expect(result.data.map(({ date }) => date)).toEqual([
      '2026-11-19',
      '2026-11-20',
    ]);
  });

  it('uses the DST-adjusted local midnight at the start of the window', async () => {
    jest.setSystemTime(new Date('2026-03-09T12:00:00.000Z'));

    await service.getDailyVolumeChart('vendor', 2, 'America/New_York');

    expect(aggregateDailyVolume.mock.calls[0][1]).toEqual(
      new Date('2026-03-08T05:00:00.000Z'),
    );
  });
});
