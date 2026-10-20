import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response body returned by PATCH /escrow/:id/buyer-contact after the
 * encrypted email and/or phone have been persisted on the escrow record.
 *
 * This is an acknowledgement DTO rather than the full escrow, because
 * the endpoint is intentionally unauthenticated and the caller should
 * not be given the full escrow state in the response.
 */
export class BuyerContactUpdateResponseDto {
  @ApiProperty({
    description: 'Short acknowledgement message confirming the write.',
    example: 'Buyer contact information updated successfully.',
  })
  message!: string;

  @ApiProperty({
    description: 'Id of the escrow whose contact info was updated.',
    format: 'uuid',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  escrowId!: string;

  @ApiPropertyOptional({
    description: 'True if an encrypted email was stored on the escrow.',
    example: true,
  })
  emailUpdated?: boolean;

  @ApiPropertyOptional({
    description: 'True if an encrypted phone was stored on the escrow.',
    example: false,
  })
  phoneUpdated?: boolean;
}
