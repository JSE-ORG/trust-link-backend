import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateBuyerContactDto } from './update-buyer-contact.dto';

function toDto(plain: Record<string, unknown>): UpdateBuyerContactDto {
  return plainToInstance(UpdateBuyerContactDto, plain);
}

describe('UpdateBuyerContactDto', () => {
  it('rejects a payload with neither email nor phone', async () => {
    const errors = await validate(toDto({}));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('_atLeastOne');
    expect(errors[0].constraints).toEqual({
      isString: 'At least one of email or phone is required',
    });
  });

  it('rejects a payload that clears both contact methods with empty strings', async () => {
    const errors = await validate(toDto({ email: '', phone: '' }));

    expect(errors.map((e) => e.property)).toContain('_atLeastOne');
  });

  it('accepts a payload with only an email', async () => {
    const errors = await validate(toDto({ email: 'buyer@example.com' }));

    expect(errors).toHaveLength(0);
  });

  it('accepts a payload with only a phone number', async () => {
    const errors = await validate(toDto({ phone: '+2348012345678' }));

    expect(errors).toHaveLength(0);
  });

  it('still validates the format of a contact method that is present', async () => {
    const errors = await validate(toDto({ email: 'not-an-email' }));

    expect(errors.map((e) => e.property)).toEqual(['email']);
  });
});
