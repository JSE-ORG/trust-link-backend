import { VendorProfileService } from './vendor-profile.service';
import { VendorProfileRepository } from './vendor-profile.repository';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';

const ADDRESS = 'GVENDOR00000000000000000000000000000000000000000000000000';

const makeProfile = (overrides = {}) => ({
  address: ADDRESS,
  businessName: 'Acme Ltd',
  email: 'acme@example.com',
  phone: null,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('VendorProfileService.upsertProfile', () => {
  let service: VendorProfileService;
  let repo: jest.Mocked<VendorProfileRepository>;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findByAddress: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateNotificationPreferences: jest.fn(),
      findNotificationPreferences: jest.fn(),
    } as unknown as jest.Mocked<VendorProfileRepository>;

    service = new VendorProfileService(repo);
  });

  it('creates a new profile when one does not exist', async () => {
    const dto: CreateVendorProfileDto = {
      businessName: 'Acme Ltd',
      email: 'acme@example.com',
    };
    const profile = makeProfile();
    repo.upsert.mockResolvedValue(profile);

    const result = await service.upsertProfile(ADDRESS, dto);

    expect(repo.upsert).toHaveBeenCalledWith(ADDRESS, dto);
    expect(result.businessName).toBe('Acme Ltd');
  });

  it('updates an existing profile idempotently', async () => {
    const dto: CreateVendorProfileDto = {
      businessName: 'Acme Renamed',
      email: 'new@example.com',
    };
    const updated = makeProfile({
      businessName: 'Acme Renamed',
      email: 'new@example.com',
    });
    repo.upsert.mockResolvedValue(updated);

    const result = await service.upsertProfile(ADDRESS, dto);

    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(result.businessName).toBe('Acme Renamed');
  });
});
