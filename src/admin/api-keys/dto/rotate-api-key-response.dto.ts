import { ApiProperty } from '@nestjs/swagger';

/**
 * Response body returned by PATCH /admin/credentials/logistics.
 * Confirms that the credential has been updated and encrypted without
 * exposing any secret key material.
 */
export class RotateApiKeyResponseDto {
  @ApiProperty({
    description: 'Confirmation message indicating the API key was updated and encrypted.',
    example: 'Logistics API key updated and encrypted',
  })
  message!: string;
}
