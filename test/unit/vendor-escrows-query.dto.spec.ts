import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VendorEscrowsQueryDto } from '../../src/escrow/dto/vendor-escrows-query.dto';

describe('VendorEscrowsQueryDto', () => {
  const toDto = (plain: Record<string, unknown>) =>
    plainToInstance(VendorEscrowsQueryDto, plain);

  it.each([
    'CREATED',
    'FUNDED',
    'SHIPPED',
    'DELIVERED',
    'RELEASED',
    'COMPLETED',
    'DISPUTED',
    'REFUNDED',
    'CANCELLED',
  ])('accepts state "%s"', async (state) => {
    const errors = await validate(toDto({ state }));
    expect(errors).toHaveLength(0);
  });

  it('rejects an unrecognised state value', async () => {
    const errors = await validate(toDto({ state: 'PENDING' }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('state');
  });

  it('is valid with no state supplied (optional field)', async () => {
    const errors = await validate(toDto({}));
    expect(errors).toHaveLength(0);
  });
});
