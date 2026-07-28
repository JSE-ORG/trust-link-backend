import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  VendorAccountDetailsRecord,
} from '../prisma/prisma.service';

@Injectable()
export class VendorAccountDetailsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns account details for the given vendor address, or null if not configured. */
  findByVendorAddress(
    vendorAddress: string,
  ): Promise<VendorAccountDetailsRecord | null> {
    return this.prisma.vendorAccountDetails.findUnique({
      where: { vendorAddress },
    });
  }

  /** Creates or updates vendor account details. */
  upsert(
    vendorAddress: string,
    data: Partial<VendorAccountDetailsRecord>,
  ): Promise<VendorAccountDetailsRecord> {
    return this.prisma.vendorAccountDetails.upsert({
      where: { vendorAddress },
      create: {
        vendorAddress,
        ...data,
      },
      update: data,
    });
  }
}
