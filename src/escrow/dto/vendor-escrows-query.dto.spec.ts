import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VendorEscrowsQueryDto } from './vendor-escrows-query.dto';

function toDto(plain: Record<string, unknown>): VendorEscrowsQueryDto {
  return plainToInstance(VendorEscrowsQueryDto, plain);
}

async function errors(plain: Record<string, unknown>): Promise<string[]> {
  const dto = toDto(plain);
  const result = await validate(dto);
  return result.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('VendorEscrowsQueryDto pagination validation (#241)', () => {
  it('accepts valid page and limit', async () => {
    expect(await errors({ page: '1', limit: '20' })).toHaveLength(0);
  });

  it('uses defaults when page and limit are omitted', () => {
    const dto = toDto({});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('rejects page=0', async () => {
    const errs = await errors({ page: '0' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /min/i.test(e) || /less than/i.test(e))).toBe(true);
  });

  it('rejects negative page', async () => {
    const errs = await errors({ page: '-1' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /min/i.test(e) || /less than/i.test(e))).toBe(true);
  });

  it('rejects limit=0', async () => {
    const errs = await errors({ limit: '0' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /min/i.test(e) || /less than/i.test(e))).toBe(true);
  });

  it('rejects limit > 100', async () => {
    const errs = await errors({ limit: '101' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /max/i.test(e) || /greater than/i.test(e))).toBe(
      true,
    );
  });

  it('accepts limit=100 (boundary)', async () => {
    expect(await errors({ limit: '100' })).toHaveLength(0);
  });

  it('rejects non-integer page', async () => {
    const errs = await errors({ page: '1.5' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /integer/i.test(e))).toBe(true);
  });

  it('rejects non-integer limit', async () => {
    const errs = await errors({ limit: '2.5' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /integer/i.test(e))).toBe(true);
  });
});
