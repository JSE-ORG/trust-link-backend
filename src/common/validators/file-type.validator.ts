import { BadRequestException } from '@nestjs/common';

/** Magic byte signatures for allowed file types. */
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  'image/webp': [
    [0x52, 0x49, 0x46, 0x46], // RIFF header
  ],
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46], // %PDF
  ],
};

const ALLOWED_MIME_TYPES = Object.keys(MAGIC_BYTES);

/** Human-readable labels for error messages. */
const ALLOWED_LABELS = 'JPEG, PNG, GIF, WebP images, and PDF files';

/**
 * Reads the first bytes of a buffer and checks them against known magic byte
 * signatures. Returns the detected MIME type or null when no signature matches.
 */
export function detectMimeType(buffer: Buffer): string | null {
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        // WebP needs an extra check at offset 8
        if (mime === 'image/webp') {
          if (
            buffer[8] === 0x57 && // W
            buffer[9] === 0x45 && // E
            buffer[10] === 0x42 && // B
            buffer[11] === 0x50 // P
          ) {
            return mime;
          }
          continue;
        }
        return mime;
      }
    }
  }
  return null;
}

/**
 * Validates that the given buffer's magic bytes match an allowed file type
 * (images and PDFs). Throws a BadRequestException on mismatch.
 */
export function validateFileType(buffer: Buffer): void {
  const mime = detectMimeType(buffer);
  if (!mime) {
    throw new BadRequestException(
      `Invalid file type. Only ${ALLOWED_LABELS} are allowed.`,
    );
  }
}

export { ALLOWED_MIME_TYPES, ALLOWED_LABELS };
