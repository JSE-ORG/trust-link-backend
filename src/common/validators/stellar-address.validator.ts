import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidStellarPublicKey } from '../../stellar/key-validation';

@ValidatorConstraint({ name: 'isStellarAddress', async: false })
export class IsStellarAddressConstraint implements ValidatorConstraintInterface {
  validate(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    return isValidStellarPublicKey(address);
  }

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
