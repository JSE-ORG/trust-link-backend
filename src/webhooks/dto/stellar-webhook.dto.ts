import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Issue #76 – Stellar Horizon webhook payload shape.
 *
 * Horizon sends a signed POST with a JSON body describing a ledger event.
 * We only mandate the fields we act on; everything else is captured in `meta`.
 */
export class StellarWebhookDto {
  @ApiProperty({
    description: 'Type of ledger event reported by Horizon.',
    example: 'payment',
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: 'Unique identifier of the Horizon operation/event.',
    example: '0123456789012345',
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'Hash of the Stellar transaction the event belongs to.',
    example: '3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889',
  })
  @IsString()
  @IsNotEmpty()
  transaction_hash: string;

  @ApiPropertyOptional({
    description: 'Destination account of the payment, if applicable.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({
    description: 'Source account of the payment, if applicable.',
    example: 'GA7QYNF7SOWQ3GLR2BGMZEHHO2LMTW5WD3KZRNQ4HBQAVPYM3VOI5JYM',
  })
  @IsString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    description: 'Payment amount as a stringified decimal.',
    example: '250.0000000',
  })
  @IsString()
  @IsOptional()
  amount?: string;

  @ApiPropertyOptional({
    description: 'Asset code of the payment (omitted for native XLM).',
    example: 'USDC',
  })
  @IsString()
  @IsOptional()
  asset_code?: string;

  @ApiPropertyOptional({
    description:
      'Any additional event fields Horizon includes, captured verbatim.',
    type: 'object',
    additionalProperties: true,
    example: { ledger: 51234567, paging_token: '220267715074457601' },
  })
  @IsObject()
  @IsOptional()
  meta?: Record<string, unknown>;
}
