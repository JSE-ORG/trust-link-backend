import { VendorAccountDetailsRepository } from './vendor-account-details.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ensureVendors } from '../../test/prisma-helpers';

describe('VendorAccountDetailsRepository', () => {
  let repo: VendorAccountDetailsRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    // VendorAccountDetails.vendorAddress is a foreign key onto
    // VendorProfile.address (#475).
    await ensureVendors(
      prisma,
      'vendor-addr',
      'vendor-addr-1',
      'vendor-addr-2',
      'vendor-addr-3',
    );
    repo = new VendorAccountDetailsRepository(prisma);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  describe('findByVendorAddress()', () => {
    it('returns null when no account details exist', async () => {
      const result = await repo.findByVendorAddress('vendor-addr');
      expect(result).toBeNull();
    });

    it('returns account details when they exist', async () => {
      const vendorAddress = 'vendor-addr-1';
      await repo.upsert(vendorAddress, {
        businessLicense: 'LIC-123',
        taxId: 'TAX-456',
      });

      const result = await repo.findByVendorAddress(vendorAddress);
      expect(result).not.toBeNull();
      expect(result?.vendorAddress).toBe(vendorAddress);
      expect(result?.businessLicense).toBe('LIC-123');
    });
  });

  describe('upsert()', () => {
    it('creates new account details when none exist', async () => {
      const vendorAddress = 'vendor-addr-2';
      const result = await repo.upsert(vendorAddress, {
        businessLicense: 'LIC-789',
        preferredCurrency: 'USDC',
      });

      expect(result.vendorAddress).toBe(vendorAddress);
      expect(result.businessLicense).toBe('LIC-789');
      expect(result.preferredCurrency).toBe('USDC');
    });

    it('updates existing account details', async () => {
      const vendorAddress = 'vendor-addr-3';
      await repo.upsert(vendorAddress, {
        businessLicense: 'LIC-OLD',
      });

      const updated = await repo.upsert(vendorAddress, {
        businessLicense: 'LIC-NEW',
      });

      expect(updated.businessLicense).toBe('LIC-NEW');
    });
  });
});
