import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidStellarPublicKey } from '../../stellar/key-validation';

@ValidatorConstraint({ name: 'isStellarAddress', async: false })
export class IsStellarAddressConstraint implements ValidatorConstraintInterface {
  /**
   * Validates that the input is a valid Stellar Ed25519 public key.
   *
   * @param address Stellar public key string to validate.
   * @returns True if address is a valid Stellar public key.
   */
  validate(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    return isValidStellarPublicKey(address);
  }

  /**
   * Returns default error message for invalid Stellar addresses.
   *
   * @returns Failure message.
   */
  defaultMessage(): string {
    return 'Address must be a valid Stellar public key';
  }
}

export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStellarAddressConstraint,
    });
  };
}
