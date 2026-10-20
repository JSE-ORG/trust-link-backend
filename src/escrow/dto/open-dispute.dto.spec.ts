import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DisputeReasonCategory, OpenDisputeDto } from './open-dispute.dto';

function toDto(plain: Record<string, unknown>): OpenDisputeDto {
  return plainToInstance(OpenDisputeDto, plain);
}

const VALID_BASE = {
  reason: DisputeReasonCategory.ITEM_NOT_RECEIVED,
  description: 'A'.repeat(20),
};

describe('OpenDisputeDto', () => {
  it('rejects a description over 2000 characters (issue #928)', async () => {
    const errors = await validate(toDto({ ...VALID_BASE, description: 'A'.repeat(2001) }));

    expect(errors.map((e) => e.property)).toContain('description');
  });

  it('rejects more than 10 evidence URLs', async () => {
    const evidenceUrls = Array.from({ length: 11 }, (_, i) => `https://evidence.trustlink.io/${i}.jpg`);
    const errors = await validate(toDto({ ...VALID_BASE, evidenceUrls }));

    expect(errors.map((e) => e.property)).toContain('evidenceUrls');
  });

  it('accepts a payload within both bounds', async () => {
    const errors = await validate(toDto({ ...VALID_BASE, evidenceUrls: ['https://evidence.trustlink.io/1.jpg'] }));

    expect(errors).toHaveLength(0);
  });
});
