import { Prisma } from '@prisma/client';
import { VendorAccountDetailsRepository } from './vendor-account-details.repository';
import {
  PrismaService,
  VendorAccountDetailsRecord,
} from '../prisma/prisma.service';
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

// ── Branch coverage for the customFields three-way branch (issue #700) ──────
//
// These run against a mocked Prisma client rather than a live database. The
// branch under test decides what is *handed to* Prisma, and a round-trip
// cannot tell the three cases apart: omitting the key and writing
// `Prisma.DbNull` both read back as `customFields: null`. Only the argument
// shows which branch ran, so these assert on the call, not on the result.

describe('VendorAccountDetailsRepository (mocked prisma)', () => {
  let repo: VendorAccountDetailsRepository;
  let upsert: jest.Mock;
  let findUnique: jest.Mock;

  const row = (overrides: Partial<VendorAccountDetailsRecord> = {}) => ({
    id: 'row-1',
    vendorAddress: 'GVENDOR',
    businessLicense: null,
    taxId: null,
    bankAccountNumber: null,
    bankRoutingNumber: null,
    paymentMethods: [],
    preferredCurrency: 'USDC',
    billingAddress: null,
    billingCity: null,
    billingState: null,
    billingCountry: null,
    billingPostalCode: null,
    shippingAddress: null,
    shippingCity: null,
    shippingState: null,
    shippingCountry: null,
    shippingPostalCode: null,
    websiteUrl: null,
    socialMediaLinks: [],
    businessHours: null,
    timezone: 'UTC',
    language: 'en',
    verificationStatus: 'PENDING',
    verifiedAt: null,
    kycStatus: 'PENDING',
    kycCompletedAt: null,
    riskScore: 0,
    complianceNotes: null,
    customFields: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    upsert = jest.fn().mockResolvedValue(row());
    findUnique = jest.fn().mockResolvedValue(null);
    repo = new VendorAccountDetailsRepository({
      vendorAccountDetails: { upsert, findUnique },
    } as unknown as PrismaService);
  });

  describe('upsert() customFields handling', () => {
    it('omits customFields entirely when the caller does not supply it', async () => {
      await repo.upsert('GVENDOR', { businessLicense: 'LIC-1' });

      const arg = upsert.mock.calls[0][0];
      // `in` rather than a value check: sending `customFields: undefined`
      // would clear the column on update, discarding fields the caller never
      // meant to touch. The key has to be absent, not merely undefined.
      expect('customFields' in arg.update).toBe(false);
      expect('customFields' in arg.create).toBe(false);
      expect(arg.update.businessLicense).toBe('LIC-1');
    });

    it('translates an explicit null into Prisma.DbNull', async () => {
      await repo.upsert('GVENDOR', { customFields: null });

      const arg = upsert.mock.calls[0][0];
      // A bare JS `null` on a Json column means "JSON null" to Prisma and is
      // rejected outright on a nullable column; DbNull is the SQL NULL that
      // actually clears it.
      expect(arg.update.customFields).toBe(Prisma.DbNull);
      expect(arg.create.customFields).toBe(Prisma.DbNull);
    });

    it('passes a populated object through unchanged', async () => {
      const customFields = { tier: 'gold', seats: 12 };

      await repo.upsert('GVENDOR', { customFields });

      const arg = upsert.mock.calls[0][0];
      expect(arg.update.customFields).toEqual(customFields);
      expect(arg.create.customFields).toEqual(customFields);
    });

    it('scopes the write by vendorAddress and seeds it on create', async () => {
      await repo.upsert('GVENDOR', { taxId: 'TAX-9' });

      const arg = upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ vendorAddress: 'GVENDOR' });
      // The update branch must not carry vendorAddress: re-keying an existing
      // row would move it to a different vendor.
      expect(arg.create.vendorAddress).toBe('GVENDOR');
      expect('vendorAddress' in arg.update).toBe(false);
    });

    it('maps an absent customFields column on the returned row to null', async () => {
      upsert.mockResolvedValue({ ...row(), customFields: undefined });

      const result = await repo.upsert('GVENDOR', {});

      expect(result.customFields).toBeNull();
    });
  });

  describe('findByVendorAddress()', () => {
    it('returns null when the row does not exist', async () => {
      findUnique.mockResolvedValue(null);

      const result = await repo.findByVendorAddress('GMISSING');

      expect(result).toBeNull();
      expect(findUnique).toHaveBeenCalledWith({
        where: { vendorAddress: 'GMISSING' },
      });
    });

    it('maps the row through toVendorAccountDetailsRecord when it exists', async () => {
      findUnique.mockResolvedValue(
        row({ customFields: { tier: 'gold' }, businessLicense: 'LIC-2' }),
      );

      const result = await repo.findByVendorAddress('GVENDOR');

      expect(result?.businessLicense).toBe('LIC-2');
      expect(result?.customFields).toEqual({ tier: 'gold' });
    });

    it('normalises a null customFields column to null rather than undefined', async () => {
      findUnique.mockResolvedValue({ ...row(), customFields: null });

      const result = await repo.findByVendorAddress('GVENDOR');

      expect(result?.customFields).toBeNull();
    });
  });
});
