import { detectMimeType, validateFileType } from './file-type.validator';
import { BadRequestException } from '@nestjs/common';

describe('detectMimeType', () => {
  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectMimeType(buf)).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(detectMimeType(buf)).toBe('image/png');
  });

  it('detects GIF87a from magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    expect(detectMimeType(buf)).toBe('image/gif');
  });

  it('detects GIF89a from magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectMimeType(buf)).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectMimeType(buf)).toBe('image/webp');
  });

  it('detects PDF from magic bytes', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(detectMimeType(buf)).toBe('application/pdf');
  });

  it('returns null for unknown magic bytes', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(detectMimeType(buf)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(detectMimeType(Buffer.from([]))).toBeNull();
  });
});

describe('validateFileType', () => {
  it('does not throw for allowed types', () => {
    expect(() =>
      validateFileType(Buffer.from([0xff, 0xd8, 0xff])),
    ).not.toThrow();
  });

  it('throws BadRequestException for unknown types', () => {
    expect(() => validateFileType(Buffer.from([0x00, 0x00, 0x00]))).toThrow(
      BadRequestException,
    );
  });
});
