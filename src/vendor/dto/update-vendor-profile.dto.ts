import { PartialType } from '@nestjs/swagger';
import { CreateVendorProfileDto } from './create-vendor-profile.dto';

/**
 * Request body for partially updating an existing vendor profile. All
 * fields are optional — only provided fields are updated. Used by
 * PATCH /vendor/profile.
 */
export class UpdateVendorProfileDto extends PartialType(
  CreateVendorProfileDto,
) {}
