import { Injectable } from '@nestjs/common';
import { PrismaService, VendorProfileRecord } from '../prisma/prisma.service';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';

@Injectable()
export class VendorProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a new vendor profile linked to the given Stellar address. */
  create(
    address: string,
    dto: CreateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.prisma.vendorProfile.create({
      data: {
        address,
        businessName: dto.businessName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        description: dto.description ?? null,
      },
    });
  }

  /** Returns the vendor profile for the given Stellar address, or null if not registered. */
  findByAddress(address: string): Promise<VendorProfileRecord | null> {
    return this.prisma.vendorProfile.findUnique({ where: { address } });
  }

  /** Updates mutable fields on the vendor profile identified by address. */
  update(
    address: string,
    dto: UpdateVendorProfileDto,
  ): Promise<VendorProfileRecord> {
    return this.prisma.vendorProfile.update({
      where: { address },
      data: dto,
    });
  }
}
