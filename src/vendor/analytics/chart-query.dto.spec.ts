import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChartQueryDto } from './chart-query.dto';

function toDto(plain: Record<string, unknown>): ChartQueryDto {
  return plainToInstance(ChartQueryDto, plain);
}

async function errors(plain: Record<string, unknown>): Promise<string[]> {
  const dto = toDto(plain);
  const result = await validate(dto);
  return result.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ChartQueryDto validation (#941)', () => {
  it('applies default values when query params are omitted', () => {
    const dto = toDto({});
    expect(dto.days).toBe(30);
    expect(dto.timezone).toBe('UTC');
  });

  describe('days parameter validation', () => {
    it('accepts valid boundary days (1 and 365)', async () => {
      expect(await errors({ days: '1' })).toHaveLength(0);
      expect(await errors({ days: '365' })).toHaveLength(0);
      expect(await errors({ days: '30' })).toHaveLength(0);
    });

    it('rejects days = 0', async () => {
      const errs = await errors({ days: '0' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /min/i.test(e) || /greater than or equal to 1/i.test(e))).toBe(true);
    });

    it('rejects negative days', async () => {
      const errs = await errors({ days: '-5' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /min/i.test(e) || /greater than or equal to 1/i.test(e))).toBe(true);
    });

    it('rejects days > 365', async () => {
      const errs = await errors({ days: '366' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /max/i.test(e) || /less than or equal to 365/i.test(e))).toBe(true);
    });

    it('rejects non-integer days', async () => {
      const errs = await errors({ days: '12.5' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /integer/i.test(e))).toBe(true);
    });

    it('rejects non-numeric string days', async () => {
      const errs = await errors({ days: 'invalid' });
      expect(errs.length).toBeGreaterThan(0);
    });
  });

  describe('timezone parameter validation', () => {
    it('accepts valid IANA timezones', async () => {
      expect(await errors({ timezone: 'UTC' })).toHaveLength(0);
      expect(await errors({ timezone: 'America/New_York' })).toHaveLength(0);
      expect(await errors({ timezone: 'Europe/London' })).toHaveLength(0);
      expect(await errors({ timezone: 'Asia/Tokyo' })).toHaveLength(0);
    });

    it('rejects invalid timezones', async () => {
      const errs = await errors({ timezone: 'Invalid/Timezone' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /timezone/i.test(e) || /time zone/i.test(e))).toBe(true);
    });
  });
});
