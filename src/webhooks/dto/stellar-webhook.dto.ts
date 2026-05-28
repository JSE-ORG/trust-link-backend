import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

/**
 * Issue #76 – Stellar Horizon webhook payload shape.
 *
 * Horizon sends a signed POST with a JSON body describing a ledger event.
 * We only mandate the fields we act on; everything else is captured in `meta`.
 */
export class StellarWebhookDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  transaction_hash: string;

  @IsString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  from?: string;

  @IsString()
  @IsOptional()
  amount?: string;

  @IsString()
  @IsOptional()
  asset_code?: string;

  @IsObject()
  @IsOptional()
  meta?: Record<string, unknown>;
}
