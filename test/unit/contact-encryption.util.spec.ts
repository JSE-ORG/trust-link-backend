import { encryptContact, decryptContact } from '../../src/common/sanitization/contact-encryption.util';

describe('contact-encryption.util', () => {
  const GOOD_KEY = 'a'.repeat(64); // 32 bytes hex

  beforeEach(() => {
    process.env.CONTACT_ENCRYPTION_KEY = GOOD_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.CONTACT_ENCRYPTION_KEY;
    jest.restoreAllMocks();
  });

  it('encrypt -> decrypt returns exact original (ASCII)', () => {
    const plain = 'user@example.com';
    const ct = encryptContact(plain);
    const out = decryptContact(ct);
    expect(out).toBe(plain);
  });

  it('round-trips empty string and unicode characters', () => {
    const empty = '';
    expect(decryptContact(encryptContact(empty))).toBe(empty);

    const uni = '名前@example.東京';
    expect(decryptContact(encryptContact(uni))).toBe(uni);
  });

  it('produces ciphertext in iv:authTag:ciphertext hex format with expected lengths', () => {
    const plain = 'foo@bar.com';
    const ct = encryptContact(plain);

    const parts = ct.split(':');
    expect(parts.length).toBe(3);

    const [ivHex, tagHex, ctHex] = parts;
    // iv is 12 bytes -> 24 hex chars
    expect(ivHex.length).toBe(12 * 2);
    // tag is 16 bytes -> 32 hex chars
    expect(tagHex.length).toBe(16 * 2);
    // ciphertext should be non-empty hex
    expect(ctHex.length).toBeGreaterThan(0);
    expect(ct).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('encrypting same input twice yields different ciphertexts (IV randomization)', () => {
    const plain = 'repeat@example.com';
    const a = encryptContact(plain);
    const b = encryptContact(plain);
    expect(a).not.toBe(b);
  });

  it('tampered ciphertext causes decryption to throw', () => {
    const plain = 'sensitive@example.com';
    const ct = encryptContact(plain);
    const parts = ct.split(':');
    // flip a nibble in the ciphertext part
    const ctHex = parts[2];
    const tamperedCt = ctHex.replace(/./, (c) => (c === '0' ? '1' : '0'));
    const tampered = [parts[0], parts[1], tamperedCt].join(':');
    expect(() => decryptContact(tampered)).toThrow();

    // tamper auth tag
    const tagHex = parts[1];
    const tamperedTag = tagHex.replace(/./, (c) => (c === '0' ? '1' : '0'));
    const tampered2 = [parts[0], tamperedTag, parts[2]].join(':');
    expect(() => decryptContact(tampered2)).toThrow();

    // tamper iv (wrong length accepted by hex->buffer but will likely fail decrypt)
    const ivHex = parts[0];
    const tamperedIv = ivHex.replace(/./, (c) => (c === '0' ? '1' : '0'));
    const tampered3 = [tamperedIv, parts[1], parts[2]].join(':');
    // may throw due to auth failure or malformed; ensure it does not silently return corrupted output
    expect(() => decryptContact(tampered3)).toThrow();
  });

  it('malformed stored string throws informative error', () => {
    expect(() => decryptContact('not-valid')).toThrow('Invalid encrypted contact format.');
    // wrong lengths for iv/tag
    const bad = ['00', '11', 'aa'].join(':');
    expect(() => decryptContact(bad)).toThrow('Malformed encrypted contact: wrong IV or tag length.');
  });

  it('missing CONTACT_ENCRYPTION_KEY throws a clear error', () => {
    delete process.env.CONTACT_ENCRYPTION_KEY;
    expect(() => encryptContact('x')).toThrow(/CONTACT_ENCRYPTION_KEY/);
    expect(() => decryptContact('00:11:22')).toThrow(/CONTACT_ENCRYPTION_KEY/);
  });

  it('invalid CONTACT_ENCRYPTION_KEY length throws a clear error', () => {
    process.env.CONTACT_ENCRYPTION_KEY = 'deadbeef'; // too short
    expect(() => encryptContact('x')).toThrow(/must be exactly 64 hex characters/);
  });
});
