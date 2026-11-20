import { parseTrustProxy } from '../../src/common/security/trust-proxy.config';

describe('parseTrustProxy (issue #971)', () => {
  it('accepts a positive hop count as a number', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('accepts a single IP address, IPv4 or IPv6', () => {
    expect(parseTrustProxy('10.0.0.5')).toEqual(['10.0.0.5']);
    expect(parseTrustProxy('2001:db8::1')).toEqual(['2001:db8::1']);
  });

  it('accepts CIDR ranges and named presets in a comma-separated list', () => {
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    expect(parseTrustProxy('loopback,uniquelocal')).toEqual([
      'loopback',
      'uniquelocal',
    ]);
    expect(parseTrustProxy('2001:db8::/32')).toEqual(['2001:db8::/32']);
  });

  it('rejects zero and negative hop counts', () => {
    expect(parseTrustProxy('0')).toBeNull();
    expect(parseTrustProxy('-1')).toBeNull();
  });

  it('rejects non-integer hop counts', () => {
    expect(parseTrustProxy('2.5')).toBeNull();
  });

  it('rejects empty and malformed values', () => {
    expect(parseTrustProxy('')).toBeNull();
    expect(parseTrustProxy('not-an-ip')).toBeNull();
    expect(parseTrustProxy('10.0.0.0/')).toBeNull();
    expect(parseTrustProxy('10.0.0.0/8/9')).toBeNull();
    expect(parseTrustProxy('10.0.0.1,')).toBeNull();
  });

  it('rejects a prefix length outside the address family', () => {
    expect(parseTrustProxy('10.0.0.0/33')).toBeNull();
    expect(parseTrustProxy('2001:db8::/129')).toBeNull();
  });

  it('rejects a list where any one entry is invalid', () => {
    expect(parseTrustProxy('10.0.0.0/8,bogus')).toBeNull();
  });
});
