import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Seeds the VendorProfile rows that escrow-related tables point at.
 *
 * `Escrow.vendorAddress`, `VendorTrackingSettings.vendorAddress` and
 * `VendorAccountDetails.vendorAddress` are all foreign keys onto
 * `VendorProfile.address`. The previous in-memory PrismaService enforced no
 * constraints, so specs could invent a vendor address inline. Against the real
 * database (#475) that fails with:
 *
 *   Foreign key constraint violated on the constraint: `Escrow_vendorAddress_fkey`
 *
 * Call this with every vendor address a spec uses, before creating rows that
 * reference them. It is idempotent, so it is safe in `beforeEach`.
 *
 * Prefer `PrismaService.reset()` for clearing state between tests: it
 * truncates under an advisory lock, so it is safe across parallel Jest
 * workers sharing one test database.
 */
export async function ensureVendors(
  prisma: PrismaService,
  ...addresses: string[]
): Promise<void> {
  if (addresses.length === 0) return;

  await prisma.vendorProfile.createMany({
    data: [...new Set(addresses)].map((address) => ({
      address,
      businessName: `Test Vendor ${address}`,
    })),
    skipDuplicates: true,
  });
}
