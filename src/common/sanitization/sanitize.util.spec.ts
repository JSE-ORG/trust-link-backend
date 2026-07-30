import { sanitizeString, sanitizeDeep } from './sanitize.util';

describe('sanitizeString', () => {
  it('strips full HTML tags from a string', () => {
    expect(sanitizeString('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('strips angle brackets left after tag removal', () => {
    expect(sanitizeString('hello <world')).toBe('hello world');
    expect(sanitizeString('5 > 3')).toBe('5  3');
  });

  it('removes control characters below 0x20 (except tab, newline, CR)', () => {
    // NUL (0x00) and DEL (0x7f) must be stripped
    expect(sanitizeString('\x00hello\x7f')).toBe('hello');
    // BEL (0x07) must be stripped
    expect(sanitizeString('be\x07ll')).toBe('bell');
  });

  it('preserves tab, newline and carriage return', () => {
    const input = 'line1\nline2\r\n\ttabbed';
    expect(sanitizeString(input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('returns a clean string unchanged', () => {
    expect(sanitizeString('hello world')).toBe('hello world');
  });

  it('strips nested and self-closing tags', () => {
    expect(sanitizeString('<b>bold</b>')).toBe('bold');
    expect(sanitizeString('<img src="x" />')).toBe('');
  });
});

describe('sanitizeDeep', () => {
  it('sanitizes a plain string', () => {
    expect(sanitizeDeep('<b>hi</b>')).toBe('hi');
  });

  it('returns numbers untouched', () => {
    expect(sanitizeDeep(42)).toBe(42);
  });

  it('returns booleans untouched', () => {
    expect(sanitizeDeep(true)).toBe(true);
  });

  it('returns null untouched', () => {
    expect(sanitizeDeep(null)).toBeNull();
  });

  it('returns undefined untouched', () => {
    expect(sanitizeDeep(undefined)).toBeUndefined();
  });

  it('sanitizes string values inside a flat object', () => {
    const input = { name: '<script>x</script>', age: 30 };
    const result = sanitizeDeep(input);
    expect(result.name).toBe('x');
    expect(result.age).toBe(30);
  });

  it('sanitizes string values inside a nested object', () => {
    const input = { outer: { inner: '<b>text</b>' } };
    const result = sanitizeDeep(input);
    expect(result.outer.inner).toBe('text');
  });

  it('sanitizes strings inside an array', () => {
    const input = ['<em>a</em>', 'clean', '<i>b</i>'];
    const result = sanitizeDeep(input);
    expect(result).toEqual(['a', 'clean', 'b']);
  });

  it('sanitizes strings inside a nested array within an object', () => {
    const input = { tags: ['<b>one</b>', 'two'] };
    const result = sanitizeDeep(input);
    expect(result.tags).toEqual(['one', 'two']);
  });

  it('handles arrays containing non-string primitives', () => {
    const input = [1, null, true, 'clean'];
    const result = sanitizeDeep(input);
    expect(result).toEqual([1, null, true, 'clean']);
  });

  it('mutates the original object in place', () => {
    const input = { value: '<b>hi</b>' };
    const result = sanitizeDeep(input);
    expect(result).toBe(input);
    expect(input.value).toBe('hi');
  });

  it('mutates the original array in place', () => {
    const input = ['<b>x</b>'];
    const result = sanitizeDeep(input);
    expect(result).toBe(input);
  });
});
