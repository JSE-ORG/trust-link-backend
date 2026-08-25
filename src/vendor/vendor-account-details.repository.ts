import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaService,
  VendorAccountDetailsRecord,
  toVendorAccountDetailsRecord,
} from '../prisma/prisma.service';

@Injectable()
export class VendorAccountDetailsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns account details for the given vendor address, or null if not configured. */
  findByVendorAddress(
    vendorAddress: string,
  ): Promise<VendorAccountDetailsRecord | null> {
    return this.prisma.vendorAccountDetails
      .findUnique({ where: { vendorAddress } })
      .then((row) => (row ? toVendorAccountDetailsRecord(row) : null));
  }

  /** Creates or updates vendor account details. */
  async upsert(
    vendorAddress: string,
    data: Partial<VendorAccountDetailsRecord>,
  ): Promise<VendorAccountDetailsRecord> {
    const { customFields, ...rest } = data;
    const writeData = {
      ...rest,
      ...(customFields !== undefined
        ? {
            customFields:
              customFields === null
                ? Prisma.DbNull
                : (customFields as Prisma.InputJsonValue),
          }
        : {}),
    };

    const row = await this.prisma.vendorAccountDetails.upsert({
      where: { vendorAddress },
      create: {
        vendorAddress,
        ...writeData,
      },
      update: writeData,
    });
    return toVendorAccountDetailsRecord(row);
  }
}
