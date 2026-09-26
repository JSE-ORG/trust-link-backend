import { Test, TestingModule } from '@nestjs/testing';
import type { AuthUser } from '../auth/auth-user';
import type { VendorAccountDetailsRecord } from '../prisma/prisma.service';
import { UpdateVendorAccountDetailsDto } from './dto/update-vendor-account-details.dto';
import { VendorAccountDetailsController } from './vendor-account-details.controller';
import { VendorAccountDetailsService } from './vendor-account-details.service';
import { VendorAccountDetailsResponseDto } from './dto/vendor-account-details-response.dto';

const VENDOR_A = 'GVENDORACCOUNTDETAILSA';

function accountDetails(
  overrides: Partial<VendorAccountDetailsRecord> = {},
): VendorAccountDetailsRecord {
  const now = new Date('2026-07-28T00:00:00.000Z');
  return {
    id: 'account-1',
    vendorAddress: VENDOR_A,
    businessLicense: null,
    taxId: 'TAX-123456789',
    bankAccountNumber: '1234567890123456',
    bankRoutingNumber: null,
    paymentMethods: [],
    preferredCurrency: 'USD',
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
    kycStatus: 'NOT_STARTED',
    kycCompletedAt: null,
    riskScore: 0,
    complianceNotes: null,
    customFields: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('VendorAccountDetailsController', () => {
  let controller: VendorAccountDetailsController;
  let service: jest.Mocked<VendorAccountDetailsService>;
  const user: AuthUser = { address: VENDOR_A };

  beforeEach(async () => {
    service = {
      getDetails: jest.fn(),
      upsertDetails: jest.fn(),
    } as unknown as jest.Mocked<VendorAccountDetailsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VendorAccountDetailsController],
      providers: [{ provide: VendorAccountDetailsService, useValue: service }],
    }).compile();

    controller = module.get(VendorAccountDetailsController);
  });

  it('returns null when the authenticated vendor has no account details', async () => {
    service.getDetails.mockResolvedValue(null);

    await expect(controller.get(user)).resolves.toBeNull();
    expect(service.getDetails).toHaveBeenCalledWith(VENDOR_A);
  });

  it('returns only the authenticated vendor record and masks its sensitive fields', async () => {
    service.getDetails.mockResolvedValue(accountDetails());

    const response = await controller.get(user);

    expect(service.getDetails).toHaveBeenCalledWith(VENDOR_A);
    expect(response).toEqual(
      expect.objectContaining({
        vendorAddress: VENDOR_A,
        taxId: '*********6789',
        bankAccountNumber: '************3456',
      }),
    );
  });

  it('upserts using the authenticated vendor address and masks sensitive fields', async () => {
    const dto: UpdateVendorAccountDetailsDto = {
      taxId: 'TAX-123456789',
      bankAccountNumber: '1234567890123456',
    };
    service.upsertDetails.mockResolvedValue(accountDetails());

    const response = await controller.update(dto, user);

    expect(service.upsertDetails).toHaveBeenCalledWith(VENDOR_A, dto);
    expect(response.taxId).toBe('*********6789');
    expect(response.bankAccountNumber).toBe('************3456');
  });
});

describe('maskSensitiveField (via VendorAccountDetailsResponseDto.fromRecord)', () => {
  function maskedTaxId(value: string | null): string | null {
    return VendorAccountDetailsResponseDto.fromRecord(
      accountDetails({ taxId: value }),
    ).taxId;
  }

  it('returns null for a null value', () => {
    expect(maskedTaxId(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(maskedTaxId('')).toBeNull();
  });

  it('returns **** for a 1-character value', () => {
    expect(maskedTaxId('A')).toBe('****');
  });

  it('returns **** for a 3-character value', () => {
    expect(maskedTaxId('ABC')).toBe('****');
  });

  it('returns **** for a value of exactly 4 characters with no digits visible', () => {
    expect(maskedTaxId('1234')).toBe('****');
  });

  it('masks all but the last 4 characters for a value longer than 4 characters', () => {
    expect(maskedTaxId('12345')).toBe('*2345');
    expect(maskedTaxId('TAX-123456789')).toBe('*********6789');
  });
});
