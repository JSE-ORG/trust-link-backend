import { IsStellarAddressConstraint } from './stellar-address.validator';

describe('IsStellarAddressConstraint', () => {
  let validator: IsStellarAddressConstraint;

  beforeEach(() => {
    validator = new IsStellarAddressConstraint();
  });

  it('should validate valid Stellar addresses', () => {
    // Use a real valid Stellar address format
    const validAddress = 'GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A';
    expect(validator.validate(validAddress)).toBe(true);
  });

  it('should reject invalid Stellar addresses', () => {
    expect(validator.validate('invalid-address')).toBe(false);
    expect(validator.validate('')).toBe(false);
    expect(validator.validate(null as any)).toBe(false);
    expect(validator.validate(undefined as any)).toBe(false);
    expect(validator.validate(123 as any)).toBe(false);
  });

  it('should reject addresses with wrong prefix', () => {
    const secretKey = 'SAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A';
    expect(validator.validate(secretKey)).toBe(false);
  });

  it('should provide default error message', () => {
    expect(validator.defaultMessage()).toBe('Address must be a valid Stellar public key');
  });
});