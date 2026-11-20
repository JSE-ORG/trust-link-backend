import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Number of decimal places in a finite number, including values that
 * `Number#toString` renders in exponent form (`5e-7`, `1.5e-8`).
 */
export function countDecimalPlaces(value: number): number {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(
    Math.abs(value).toString(),
  );
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }
  const fractionDigits = match[2]?.length ?? 0;
  const exponent = match[3] ? Number(match[3]) : 0;
  return Math.max(0, fractionDigits - exponent);
}

/**
 * class-validator's `@IsNumber({ maxDecimalPlaces })` reads the digits after
 * `.` in `value.toString()`, so it throws on numbers below 1e-6 (rendered as
 * `5e-7`) and turns a validation failure into a 500. This constraint counts
 * decimal places for both notations.
 */
@ValidatorConstraint({ name: 'maxDecimalPlaces', async: false })
export class MaxDecimalPlacesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [maxPlaces] = args.constraints as [number];
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      countDecimalPlaces(value) <= maxPlaces
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const [maxPlaces] = args.constraints as [number];
    return `${args.property} must have at most ${maxPlaces} decimal places`;
  }
}

export function MaxDecimalPlaces(
  maxPlaces: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [maxPlaces],
      validator: MaxDecimalPlacesConstraint,
    });
  };
}
