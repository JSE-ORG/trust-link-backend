import { NotFoundException } from '@nestjs/common';
import { VendorAccountDetailsRepository } from './vendor-account-details.repository';
import { VendorAccountDetailsService } from './vendor-account-details.service';

describe('VendorAccountDetailsService', () => {
  const details = { id: 'details-1', vendorAddress: 'vendor-1' };
  const repository = {
    findByVendorAddress: jest.fn(),
    upsert: jest.fn(),
  } as unknown as jest.Mocked<VendorAccountDetailsRepository>;
  const service = new VendorAccountDetailsService(repository);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['returns configured details', details],
    ['returns null when no details are configured', null],
  ])('%s', async (_name, found) => {
    repository.findByVendorAddress.mockResolvedValue(found as never);

    await expect(service.getDetails('vendor-1')).resolves.toBe(found);
    expect(repository.findByVendorAddress).toHaveBeenCalledWith('vendor-1');
  });

  it('returns details from getDetailsOrThrow when they exist', async () => {
    repository.findByVendorAddress.mockResolvedValue(details as never);

    await expect(service.getDetailsOrThrow('vendor-1')).resolves.toBe(details);
  });

  it('raises a meaningful not-found error when details are absent', async () => {
    repository.findByVendorAddress.mockResolvedValue(null);

    await expect(service.getDetailsOrThrow('vendor-1')).rejects.toEqual(
      expect.objectContaining({ message: 'Vendor account details not found' }),
    );
    await expect(service.getDetailsOrThrow('vendor-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('upserts the supplied account details for the requested vendor', async () => {
    const dto = { preferredCurrency: 'USDC', timezone: 'Africa/Lagos' };
    repository.upsert.mockResolvedValue({ ...details, ...dto } as never);

    await expect(service.upsertDetails('vendor-1', dto)).resolves.toMatchObject(
      dto,
    );
    expect(repository.upsert).toHaveBeenCalledWith('vendor-1', dto);
  });
});
