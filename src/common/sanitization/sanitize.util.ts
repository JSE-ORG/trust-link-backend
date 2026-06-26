/**
 * Issue #83 - shared text sanitization rules.
 *
 * These helpers neutralize the characters most commonly used in script
 * injection / XSS payloads so that no user-supplied string reaches a route
 * handler (or the database) with an embedded markup or control sequence.
 */

// Any `<...>` sequence - strips full HTML/script tags.
const HTML_TAGS = /<[^>]*>/g;
// Stray angle brackets left after tag removal.
const ANGLE_BRACKETS = /[<>]/g;

/**
 * Drops non-printable control characters (code points 0x00-0x1F and 0x7F)
 * while preserving tab (0x09), newline (0x0A) and carriage return (0x0D),
 * which are legitimate text content.
 */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl =
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f;
    if (!isControl) {
      out += ch;
    }
  }
  return out;
}

/** Removes dangerous characters from a single string value. */
export function sanitizeString(value: string): string {
  return stripControlChars(value)
    .replace(HTML_TAGS, '')
    .replace(ANGLE_BRACKETS, '');
}

/**
 * Recursively sanitizes every string contained in a value, mutating objects
 * and arrays in place so DTO class instances keep their type while their
 * string fields are cleaned. Non-string primitives are returned untouched.
 */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeString(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = sanitizeDeep(value[i]);
    }
    return value;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = sanitizeDeep(record[key]);
    }
    return value;
  }

  return value;
}
