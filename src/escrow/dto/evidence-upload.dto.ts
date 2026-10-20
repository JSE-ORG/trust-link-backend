import { ApiProperty } from '@nestjs/swagger';

/**
 * Response containing a pre-signed upload URL for evidence files.
 * The caller uploads directly to cloud storage using the uploadUrl,
 * and the publicUrl can be stored as an evidence reference.
 */
export class EvidenceUploadResponseDto {
  @ApiProperty({
    description: 'Pre-signed URL for uploading evidence to cloud storage.',
    example:
      'https://storage.trustlink.io/evidence/USER_ADDR/uuid.jpg?X-Expires=...&X-Signature=...',
  })
  uploadUrl!: string;

  @ApiProperty({
    description: 'Public URL of the uploaded file after upload completes.',
    example: 'https://storage.trustlink.io/evidence/USER_ADDR/uuid.jpg',
  })
  publicUrl!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the pre-signed URL expires.',
    example: '2026-06-01T13:00:00.000Z',
  })
  expiresAt!: string;

  @ApiProperty({
    description: 'TTL in seconds until the pre-signed URL expires.',
    example: 3600,
  })
  expiresInSeconds!: number;

  @ApiProperty({
    description: 'Original filename for client reference.',
    example: 'damage-photo.jpg',
  })
  fileName!: string;

  @ApiProperty({
    description: 'User-specific key prefix for object storage isolation.',
    example:
      'evidence/GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5/',
  })
  storagePath!: string;
}
