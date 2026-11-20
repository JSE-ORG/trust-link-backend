import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RotateApiKeyDto } from './rotate-api-key.dto';

function validateKey(key: unknown) {
  return validate(plainToInstance(RotateApiKeyDto, { key }));
}

describe('RotateApiKeyDto (issue #1112)', () => {
  it('accepts a key of exactly 512 characters', async () => {
    expect(await validateKey('k'.repeat(512))).toHaveLength(0);
  });

  it('rejects a key over 512 characters', async () => {
    const errors = await validateKey('k'.repeat(513));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('trims surrounding whitespace before the length check', async () => {
    const dto = plainToInstance(RotateApiKeyDto, {
      key: `  ${'k'.repeat(512)}  `,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.key).toHaveLength(512);
  });

  it('rejects a whitespace-only key', async () => {
    expect(await validateKey('   ')).not.toHaveLength(0);
  });
});
