import { Keypair, StrKey } from '@stellar/stellar-sdk';

/** Checks a Stellar G... public key without exposing SDK imports to callers. */
export function isValidStellarPublicKey(value: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(value);
  } catch {
    return false;
  }
}

/** Decodes a Stellar public key and throws when it is malformed. */
export function assertValidStellarPublicKey(value: string): void {
  Keypair.fromPublicKey(value);
}

/** Decodes a Stellar secret key and throws when it is malformed. */
export function assertValidStellarSecretKey(value: string): void {
  Keypair.fromSecret(value);
}
