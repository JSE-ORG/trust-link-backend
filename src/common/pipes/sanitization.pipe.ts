import { Injectable, PipeTransform } from '@nestjs/common';
import { sanitizeDeep } from '../sanitization/sanitize.util';

/**
 * Issue #83 - global input sanitization pipe.
 *
 * Registered after the ValidationPipe so it operates on values that have
 * already been validated and transformed into their DTO shape (malformed
 * objects are therefore rejected before they ever reach this pipe). It then
 * recursively strips dangerous characters from every string field, removing
 * script-injection payloads before they reach route handlers or persistence.
 */
@Injectable()
export class SanitizationPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return sanitizeDeep(value);
  }
}
