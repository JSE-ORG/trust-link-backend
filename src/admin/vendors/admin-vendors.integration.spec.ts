import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VendorProfileRepository } from '../../vendor/vendor-profile.repository';
import { AnalyticsService } from '../../vendor/analytics/analytics.service';
import { AnalyticsRepository } from '../../vendor/analytics/analytics.repository';
import { VendorAccountDetailsRepository } from '../../vendor/vendor-account-details.repository';
import { AdminVendorsController } from './admin-vendors.controller';

describe('AdminVendors Integration Test (#1152)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let controller: AdminVendorsController;

  const vendorA = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const vendorB = 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G6EXO2Z6K452Z25MQSPA';
  const vendorC = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS6XYKA';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        VendorProfileRepository,
        AnalyticsService,
        AnalyticsRepository,
        VendorAccountDetailsRepository,
        AdminVendorsController,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ADMIN_ADDRESS') return vendorA;
              return null;
            }),
          },
        },
      ],
    }).compile();

    prisma = module.get(PrismaService);
    controller = module.get(AdminVendorsController);
  });

  beforeEach(async () => {
    await prisma.reset();

    // Create 3 vendors
    await prisma.vendorProfile.createMany({
      data: [
        {
          address: vendorA,
          businessName: 'Alpha Supplies',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          address: vendorB,
          businessName: 'Beta Electronics',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        {
          address: vendorC,
          businessName: 'Gamma General',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
    });

    // Seed escrows for vendorA: 1 COMPLETED, 1 RELEASED, 1 DISPUTED, 1 FUNDED (total 4)
    await prisma.escrow.createMany({
      data: [
        {
          vendorAddress: vendorA,
          buyerAddress: 'GBUYER1',
          itemName: 'Item A1',
          itemRef: 'ref-a1',
          amount: 100,
          currency: 'USDC',
          state: 'COMPLETED',
        },
        {
          vendorAddress: vendorA,
          buyerAddress: 'GBUYER1',
          itemName: 'Item A2',
          itemRef: 'ref-a2',
          amount: 50,
          currency: 'USDC',
          state: 'RELEASED',
        },
        {
          vendorAddress: vendorA,
          buyerAddress: 'GBUYER1',
          itemName: 'Item A3',
          itemRef: 'ref-a3',
          amount: 75,
          currency: 'USDC',
          state: 'DISPUTED',
        },
        {
          vendorAddress: vendorA,
          buyerAddress: 'GBUYER1',
          itemName: 'Item A4',
          itemRef: 'ref-a4',
          amount: 25,
          currency: 'USDC',
          state: 'FUNDED',
        },
      ],
    });

    // Seed escrows for vendorB: 1 COMPLETED (total 1)
    await prisma.escrow.create({
      data: {
        vendorAddress: vendorB,
        buyerAddress: 'GBUYER2',
        itemName: 'Item B1',
        itemRef: 'ref-b1',
        amount: 200,
        currency: 'USDC',
        state: 'COMPLETED',
      },
    });

    // vendorC has 0 escrows
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await module.close();
  });

  it('lists all vendors with correct escrow, completed, and disputed counts', async () => {
    const result = await controller.listVendors({});

    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);

    const a = result.data.find((v) => v.address === vendorA);
    expect(a).toBeDefined();
    expect(a?.businessName).toBe('Alpha Supplies');
    expect(a?.escrowCount).toBe(4);
    expect(a?.completedCount).toBe(2); // COMPLETED + RELEASED
    expect(a?.disputedCount).toBe(1);

    const b = result.data.find((v) => v.address === vendorB);
    expect(b).toBeDefined();
    expect(b?.businessName).toBe('Beta Electronics');
    expect(b?.escrowCount).toBe(1);
    expect(b?.completedCount).toBe(1);
    expect(b?.disputedCount).toBe(0);

    const c = result.data.find((v) => v.address === vendorC);
    expect(c).toBeDefined();
    expect(c?.businessName).toBe('Gamma General');
    expect(c?.escrowCount).toBe(0);
    expect(c?.completedCount).toBe(0);
    expect(c?.disputedCount).toBe(0);
  });

  it('filters vendors by optional search on businessName or address', async () => {
    const searchByName = await controller.listVendors({ search: 'beta' });
    expect(searchByName.total).toBe(1);
    expect(searchByName.data[0].address).toBe(vendorB);

    const searchByAddr = await controller.listVendors({
      search: vendorC.slice(0, 10),
    });
    expect(searchByAddr.total).toBe(1);
    expect(searchByAddr.data[0].address).toBe(vendorC);
  });

  it('handles pagination parameters correctly', async () => {
    const page1 = await controller.listVendors({ page: 1, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.data).toHaveLength(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.totalPages).toBe(2);

    const page2 = await controller.listVendors({ page: 2, limit: 2 });
    expect(page2.total).toBe(3);
    expect(page2.data).toHaveLength(1);
    expect(page2.page).toBe(2);
  });
});
