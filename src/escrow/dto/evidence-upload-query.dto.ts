import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** File extensions accepted for evidence uploads. */
export const EVIDENCE_FILE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
] as const;

const EVIDENCE_FILE_NAME = new RegExp(
  `^[^/\\\\]+\\.(${EVIDENCE_FILE_EXTENSIONS.join('|')})$`,
  'i',
);

/** Query parameters for POST /escrow/evidence-upload. */
export class EvidenceUploadQueryDto {
  @ApiProperty({
    description: `Original file name. Must end in one of: ${EVIDENCE_FILE_EXTENSIONS.join(', ')}.`,
    example: 'damage-photo.jpg',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(EVIDENCE_FILE_NAME, {
    message: `fileName must have no path separators and end in one of: ${EVIDENCE_FILE_EXTENSIONS.join(', ')}`,
  })
  fileName!: string;
}
