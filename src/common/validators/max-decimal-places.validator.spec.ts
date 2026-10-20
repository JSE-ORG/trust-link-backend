import { ValidationArguments } from 'class-validator';
import {
  countDecimalPlaces,
  MaxDecimalPlacesConstraint,
} from './max-decimal-places.validator';

describe('countDecimalPlaces', () => {
  it.each([
    [0, 0],
    [125, 0],
    [2499.99, 2],
    [0.12345678, 8],
    [0.123456789, 9],
    [-1.25, 2],
    [5e-7, 7],
    [1e-8, 8],
    [1.5e-8, 9],
    [1e21, 0],
  ])('counts %p as %p decimal places', (value, expected) => {
    expect(countDecimalPlaces(value)).toBe(expected);
  });
});

describe('MaxDecimalPlacesConstraint', () => {
  const validator = new MaxDecimalPlacesConstraint();
  const args = {
    constraints: [8],
    property: 'amount',
  } as unknown as ValidationArguments;

  it('accepts numbers within the limit, including exponent notation', () => {
    expect(validator.validate(0.12345678, args)).toBe(true);
    expect(validator.validate(5e-7, args)).toBe(true);
  });

  it('rejects numbers over the limit', () => {
    expect(validator.validate(0.123456789, args)).toBe(false);
    expect(validator.validate(1e-9, args)).toBe(false);
  });

  it('rejects non-numbers and non-finite numbers', () => {
    expect(validator.validate('0.1', args)).toBe(false);
    expect(validator.validate(Number.NaN, args)).toBe(false);
    expect(validator.validate(Number.POSITIVE_INFINITY, args)).toBe(false);
  });

  it('names the property and limit in the message', () => {
    expect(validator.defaultMessage(args)).toBe(
      'amount must have at most 8 decimal places',
    );
  });
});
