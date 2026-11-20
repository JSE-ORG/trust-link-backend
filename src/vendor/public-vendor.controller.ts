import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StrKey } from '@stellar/stellar-sdk';
import { EscrowRepository } from '../escrow/escrow.repository';
import { VendorProfileRepository } from './vendor-profile.repository';
import { PublicVendorProfileDto } from './dto/public-vendor-profile.dto';

@ApiTags('Vendors')
@Controller('vendors')
export class PublicVendorController {
  constructor(
    private readonly vendorProfileRepository: VendorProfileRepository,
    private readonly escrowRepository: EscrowRepository,
  ) {}

  @ApiOperation({
    summary: 'Get public vendor profile for buyers',
    description:
      'Returns public trust signal data for a vendor: businessName, description, member since date, completed escrows count and dispute rate.',
  })
  @ApiParam({
    name: 'address',
    description: 'Stellar public address of the vendor',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @ApiResponse({
    status: 200,
    description: 'Public vendor profile returned successfully.',
    type: PublicVendorProfileDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address.' })
  @ApiResponse({ status: 404, description: 'Vendor not found.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Get(':address')
  async getPublicProfile(
    @Param('address') address: string,
  ): Promise<PublicVendorProfileDto> {
    if (!address || !StrKey.isValidEd25519PublicKey(address)) {
      throw new BadRequestException('Invalid Stellar address');
    }

    const vendor = await this.vendorProfileRepository.findByAddress(address);
    if (!vendor) {
      throw new NotFoundException(`Vendor with address ${address} not found`);
    }

    const stats = await this.escrowRepository.getVendorPublicStats(address);

    return {
      businessName: vendor.businessName,
      description: vendor.description,
      memberSince: vendor.createdAt,
      completedEscrows: stats.completedEscrows,
      disputeRate: stats.disputeRate,
    };
  }
}
