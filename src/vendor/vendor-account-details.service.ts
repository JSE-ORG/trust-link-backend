import { Injectable, NotFoundException } from '@nestjs/common';
import { VendorAccountDetailsRecord } from '../prisma/prisma.service';
import { UpdateVendorAccountDetailsDto } from './dto/update-vendor-account-details.dto';
import { VendorAccountDetailsRepository } from './vendor-account-details.repository';
import { TracingService } from '../tracing/tracing.service';

@Injectable()
export class VendorAccountDetailsService {
  constructor(
    private readonly repository: VendorAccountDetailsRepository,
    private readonly tracing: TracingService,
  ) {}

  /**
   * Runs `fn` inside a span named for the account-details operation.
   *
   * Only the vendor address is recorded. The details themselves (bank
   * account numbers and payout identifiers) are deliberately excluded.
   */
  private traced<T>(
    operation: string,
    vendorAddress: string,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    return this.tracing.withSpan(
      `vendor.account_details.${operation}`,
      {
        attributes: {
          'trustlink.vendor.address': vendorAddress,
        },
      },
      fn,
    );
  }

  /**
   * Returns the stored payout/account details for `vendorAddress`, or `null`
   * when the vendor has never called {@link upsertDetails}.
   *
   * The nullable return is the "read for a UI that may show an empty form"
   * path; callers that require the record must use {@link getDetailsOrThrow}
   * instead of asserting on this. Never throws for a missing row.
   */
  async getDetails(
    vendorAddress: string,
  ): Promise<VendorAccountDetailsRecord | null> {
    return this.traced('get', vendorAddress, () =>
      this.repository.findByVendorAddress(vendorAddress),
    );
  }

  /**
   * Same lookup as {@link getDetails}, but throws `NotFoundException` when no
   * row exists rather than returning `null`.
   *
   * Use this on paths that genuinely cannot proceed without account details
   * (e.g. initiating a payout) so the 404 is raised at the boundary instead
   * of surfacing as a downstream null-dereference.
   */
  async getDetailsOrThrow(
    vendorAddress: string,
  ): Promise<VendorAccountDetailsRecord> {
    return this.traced('get_or_throw', vendorAddress, async () => {
      const details = await this.repository.findByVendorAddress(vendorAddress);
      if (!details) {
        throw new NotFoundException('Vendor account details not found');
      }
      return details;
    });
  }

  /**
   * Creates the vendor's account-details row, or overwrites it with `dto` if
   * it already exists (full upsert on `vendorAddress`).
   *
   * Idempotent and safe to retry: calling it twice with the same `dto`
   * leaves the same state. Create-vs-update field semantics are delegated to
   * `VendorAccountDetailsRepository.upsert`. No vendor-profile-existence
   * check is performed here.
   */
  async upsertDetails(
    vendorAddress: string,
    dto: UpdateVendorAccountDetailsDto,
  ): Promise<VendorAccountDetailsRecord> {
    return this.traced('upsert', vendorAddress, () =>
      this.repository.upsert(vendorAddress, dto),
    );
  }
}
