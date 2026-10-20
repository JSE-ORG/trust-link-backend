import { SanitizationPipe } from '../../src/common/pipes/sanitization.pipe';

describe('SanitizationPipe', () => {
  let pipe: SanitizationPipe;

  beforeEach(() => {
    pipe = new SanitizationPipe();
  });

  it('sanitizes a flat body', () => {
    const result = pipe.transform({ name: '<script>alert(1)</script>Alice' });
    expect(result).toEqual({ name: 'alert(1)Alice' });
  });

  it('sanitizes a nested object', () => {
    const result = pipe.transform({
      profile: { bio: '<img src=x onerror=alert(1)>Hello' },
    });
    expect(result).toEqual({ profile: { bio: 'Hello' } });
  });

  it('sanitizes an array of objects', () => {
    const result = pipe.transform({
      items: [{ label: '<b>bold</b>' }, { label: 'plain' }],
    });
    expect(result).toEqual({
      items: [{ label: 'bold' }, { label: 'plain' }],
    });
  });

  it('leaves non-string values (number, boolean, null, Date) unchanged', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const input = { count: 5, active: true, deletedAt: null, createdAt: date };

    const result = pipe.transform(input) as typeof input;

    expect(result.count).toBe(5);
    expect(result.active).toBe(true);
    expect(result.deletedAt).toBeNull();
    expect(result.createdAt).toBe(date);
  });

  it('sanitizes a value containing markup', () => {
    const result = pipe.transform({ note: '<script>evil()</script>' });
    expect(result).toEqual({ note: 'evil()' });
  });

  it('leaves an ordinary value alone', () => {
    const result = pipe.transform({ note: 'a perfectly normal note' });
    expect(result).toEqual({ note: 'a perfectly normal note' });
  });

  it('mutates the caller-supplied object in place (documented behavior of sanitizeDeep)', () => {
    const input = { name: '<b>Alice</b>' };
    const result = pipe.transform(input);
    expect(result).toBe(input);
    expect(input.name).toBe('Alice');
  });
});
