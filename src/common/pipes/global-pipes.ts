import { ValidationPipe } from '@nestjs/common';
import { SanitizationPipe } from './sanitization.pipe';

/**
 * Returns the ordered global pipe array used by both `main.ts` and test
 * harnesses (issue #968).
 *
 * Order matters:
 *   1. SanitizationPipe  — strips HTML tags and control chars from every
 *      string field *before* class-validator runs, so length/format rules
 *      see the sanitised value that will actually be stored.
 *   2. ValidationPipe    — validates the already-sanitised values.
 *
 * Previously the pipes were registered in the opposite order, which allowed
 * payloads like `<b></b><i></i><u></u>abcdefgh` (26 chars raw, 8 after
 * sanitisation) to pass @MinLength(20) and be stored as only 8 characters.
 */
export function createGlobalPipes(): [SanitizationPipe, ValidationPipe] {
  return [
    new SanitizationPipe(),
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  ];
}
