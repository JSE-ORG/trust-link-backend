import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEscrowDto, ESCROW_AMOUNT_MAX } from './create-escrow.dto';

const validBody = {
  itemName: 'Sony A7 IV Mirrorless Camera',
  itemRef: 'SKU-CAM-A7IV-001',
  amount: 2499.99,
  currency: 'USDC',
  buyerAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

function toDto(overrides: Record<string, unknown>): CreateEscrowDto {
  return plainToInstance(CreateEscrowDto, { ...validBody, ...overrides });
}

async function failingProperties(
  overrides: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(toDto(overrides));
  return errors.map((error) => error.property);
}

describe('CreateEscrowDto', () => {
  it('accepts a valid body', async () => {
    await expect(failingProperties({})).resolves.toEqual([]);
  });

  // issue #933: the column is Decimal(18, 8).
  describe('amount', () => {
    it.each([0.00000001, 0.12345678, 5e-7, 1.5e-8 * 2, ESCROW_AMOUNT_MAX])(
      'accepts %p',
      async (amount) => {
        await expect(failingProperties({ amount })).resolves.toEqual([]);
      },
    );

    it.each([0.123456789, 1e-9, 1.5e-8, 0.000000015])(
      'rejects %p for having more than 8 decimal places',
      async (amount) => {
        await expect(failingProperties({ amount })).resolves.toEqual([
          'amount',
        ]);
      },
    );

    it.each([ESCROW_AMOUNT_MAX + 1, 1e10, 1e12])(
      'rejects %p for not fitting Decimal(18, 8)',
      async (amount) => {
        await expect(failingProperties({ amount })).resolves.toEqual([
          'amount',
        ]);
      },
    );

    it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
      'rejects %p',
      async (amount) => {
        await expect(failingProperties({ amount })).resolves.toEqual([
          'amount',
        ]);
      },
    );
  });

  // issue #934
  describe('itemRef', () => {
    it('trims surrounding whitespace', () => {
      expect(toDto({ itemRef: '  SKU-1  ' }).itemRef).toBe('SKU-1');
    });

    it('accepts 100 characters', async () => {
      await expect(
        failingProperties({ itemRef: 'a'.repeat(100) }),
      ).resolves.toEqual([]);
    });

    it('rejects more than 100 characters', async () => {
      await expect(
        failingProperties({ itemRef: 'a'.repeat(101) }),
      ).resolves.toEqual(['itemRef']);
    });

    it('applies the minimum length after trimming', async () => {
      await expect(failingProperties({ itemRef: '  ab  ' })).resolves.toEqual([
        'itemRef',
      ]);
    });

    it('rejects a non-string without throwing', async () => {
      await expect(failingProperties({ itemRef: 12345 })).resolves.toEqual([
        'itemRef',
      ]);
    });
  });
});
