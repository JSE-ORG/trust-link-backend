import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { VendorProfileRepository } from '../../vendor/vendor-profile.repository';
import { AdminVendorsController } from './admin-vendors.controller';

describe('AdminVendorsController (#1152)', () => {
  const vendorProfileRepository: jest.Mocked<
    Pick<VendorProfileRepository, 'listVendorsForAdmin'>
  > = {
    listVendorsForAdmin: jest.fn(),
  };

  const controller = new AdminVendorsController(
    vendorProfileRepository as unknown as VendorProfileRepository,
  );

  afterEach(() => jest.clearAllMocks());

  it('applies JWT and admin guards to the controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminVendorsController),
    ).toEqual([JwtGuard, AdminGuard]);
  });

  it('delegates query to vendorProfileRepository.listVendorsForAdmin', async () => {
    const expected = {
      data: [
        {
          address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          businessName: 'Acme Corp',
          createdAt: new Date(),
          escrowCount: 5,
          completedCount: 4,
          disputedCount: 1,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    vendorProfileRepository.listVendorsForAdmin.mockResolvedValue(expected);

    const query = { page: 1, limit: 20, search: 'Acme' };
    const result = await controller.listVendors(query);

    expect(result).toBe(expected);
    expect(vendorProfileRepository.listVendorsForAdmin).toHaveBeenCalledWith(
      query,
    );
  });
});
