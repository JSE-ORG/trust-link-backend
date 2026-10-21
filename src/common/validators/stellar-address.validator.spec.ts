import { IsStellarAddressConstraint } from './stellar-address.validator';

describe('IsStellarAddressConstraint', () => {
  let validator: IsStellarAddressConstraint;

  beforeEach(() => {
    validator = new IsStellarAddressConstraint();
  });

  it('should validate valid Stellar addresses', () => {
    // Use a real valid Stellar address format
    const validAddress =
      'GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A';
    expect(validator.validate(validAddress)).toBe(true);
  });

  it('should reject invalid Stellar addresses', () => {
    expect(validator.validate('invalid-address')).toBe(false);
    expect(validator.validate('')).toBe(false);
    // Cast through unknown: validate() is typed to accept string, but the
    // point of this test is that non-string garbage is rejected at runtime.
    expect(validator.validate(null as unknown as string)).toBe(false);
    expect(validator.validate(undefined as unknown as string)).toBe(false);
    const numInput: unknown = 123;
    expect(validator.validate(numInput as string)).toBe(false);
  });

  it('should reject addresses with wrong prefix', () => {
    const secretKey =
      'SAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A';
    expect(validator.validate(secretKey)).toBe(false);
  });

  it('should provide default error message', () => {
    expect(validator.defaultMessage()).toBe(
      'Address must be a valid Stellar public key',
    );
  });
});
