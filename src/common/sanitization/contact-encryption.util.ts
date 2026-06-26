import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SEPARATOR = ':';

/**
 * Derives a 32-byte key from the CONTACT_ENCRYPTION_KEY env variable.
 * The env value is hex-encoded (64 hex chars = 32 bytes). If absent the
 * module throws at startup so the missing config is caught immediately.
 */
function resolveKey(): Buffer {
  const raw = process.env.CONTACT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CONTACT_ENCRYPTION_KEY environment variable is required for buyer contact encryption.',
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `CONTACT_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${key.length} bytes.`,
    );
  }
  return key;
}

/**
 * Encrypts a UTF-8 plaintext string with AES-256-GCM.
 * Output format (all hex, colon-separated): `iv:authTag:ciphertext`
 *
 * A fresh IV is generated per call so encrypting the same value twice
 * produces different ciphertext — prevents correlation attacks.
 */
export function encryptContact(plaintext: string): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex'),
  ].join(SEPARATOR);
}

/**
 * Decrypts a value produced by `encryptContact`.
 * Returns the plaintext string, or throws if the ciphertext is tampered.
 */
export function decryptContact(stored: string): string {
  const key = resolveKey();
  const parts = stored.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted contact format.');
  }
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed encrypted contact: wrong IV or tag length.');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    'utf8',
  );
}