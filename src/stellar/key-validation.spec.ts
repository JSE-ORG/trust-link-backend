import { Keypair } from '@stellar/stellar-sdk';
import {
  assertValidStellarPublicKey,
  assertValidStellarSecretKey,
  isValidStellarPublicKey,
} from './key-validation';

describe('Stellar key validation helpers', () => {
  const keypair = Keypair.random();

  it('accepts a valid public key and rejects invalid values', () => {
    expect(isValidStellarPublicKey(keypair.publicKey())).toBe(true);
    expect(isValidStellarPublicKey('not-a-key')).toBe(false);
  });

  it('decodes valid public and secret keys', () => {
    expect(() =>
      assertValidStellarPublicKey(keypair.publicKey()),
    ).not.toThrow();
    expect(() => assertValidStellarSecretKey(keypair.secret())).not.toThrow();
  });

  it('throws for invalid keys and for a secret passed as a public key', () => {
    expect(() => assertValidStellarPublicKey(keypair.secret())).toThrow();
    expect(() => assertValidStellarSecretKey('not-a-key')).toThrow();
  });
});
