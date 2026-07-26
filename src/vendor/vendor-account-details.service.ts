import { Injectable, NotFoundException } from '@nestjs/common';
import { VendorAccountDetailsRecord } from '../prisma/prisma.service';
import { UpdateVendorAccountDetailsDto } from './dto/update-vendor-account-details.dto';
import { VendorAccountDetailsRepository } from './vendor-account-details.repository';

@Injectable()
export class VendorAccountDetailsService {
  constructor(private readonly repository: VendorAccountDetailsRepository) {}

  /** Returns account details for the given vendor, or null if not configured. */
  async getDetails(
    vendorAddress: string,
  ): Promise<VendorAccountDetailsRecord | null> {
    return this.repository.findByVendorAddress(vendorAddress);
  }

  /** Returns account details for the given vendor, raising not-found if absent. */
  async getDetailsOrThrow(
    vendorAddress: string,
  ): Promise<VendorAccountDetailsRecord> {
    const details = await this.repository.findByVendorAddress(vendorAddress);
    if (!details) {
      throw new NotFoundException('Vendor account details not found');
    }
    return details;
  }

  /** Creates or updates vendor account details. */
  async upsertDetails(
    vendorAddress: string,
    dto: UpdateVendorAccountDetailsDto,
  ): Promise<VendorAccountDetailsRecord> {
    return this.repository.upsert(vendorAddress, dto);
  }
}
