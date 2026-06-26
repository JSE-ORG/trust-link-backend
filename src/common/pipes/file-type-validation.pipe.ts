import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import {
  validateFileType,
  ALLOWED_LABELS,
} from '../validators/file-type.validator';

interface UploadedFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

@Injectable()
export class FileTypeValidationPipe implements PipeTransform {
  transform(value: UploadedFile | undefined): UploadedFile {
    if (!value || !value.buffer) {
      throw new BadRequestException('No file provided');
    }
    validateFileType(value.buffer);
    return value;
  }
}

export { ALLOWED_LABELS };
