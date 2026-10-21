import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateVendorProfileDto } from './update-vendor-profile.dto';

function toDto(plain: Record<string, unknown>): UpdateVendorProfileDto {
  return plainToInstance(UpdateVendorProfileDto, plain);
}

describe('UpdateVendorProfileDto', () => {
  it('accepts an empty payload since all fields are optional', async () => {
    const errors = await validate(toDto({}));
    expect(errors).toHaveLength(0);
  });

  it('accepts valid partial fields', async () => {
    const errors = await validate(
      toDto({
        businessName: 'Valid Name',
        email: 'test@example.com',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid email format', async () => {
    const errors = await validate(
      toDto({
        email: 'not-an-email',
      }),
    );
    expect(errors.map((e) => e.property)).toContain('email');
  });

  it('rejects a business name that is too short', async () => {
    const errors = await validate(
      toDto({
        businessName: 'A',
      }),
    );
    expect(errors.map((e) => e.property)).toContain('businessName');
  });

  it('rejects a business name that is too long', async () => {
    const errors = await validate(
      toDto({
        businessName: 'A'.repeat(101),
      }),
    );
    expect(errors.map((e) => e.property)).toContain('businessName');
  });
});
