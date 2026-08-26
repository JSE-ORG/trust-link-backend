import { VendorProfileRepository } from './vendor-profile.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('VendorProfileRepository', () => {
  const profile = {
    address: 'vendor-1',
    businessName: 'Original',
    email: null,
    phone: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const trackingSettings = {
    id: 'settings-1',
    vendorAddress: 'vendor-1',
    enableTracking: false,
    trackingProvider: null,
    trackingApiKey: null,
    autoUpdateTracking: true,
    trackingUpdateInterval: 12,
    notifyOnDelivery: false,
    notifyOnDelay: false,
    notifyOnException: false,
    delayThresholdHours: 36,
    deliveryConfirmation: false,
    requireSignature: false,
    insuranceRequired: false,
    insuranceValue: null,
    customTrackingRules: null,
    webhookUrl: 'https://example.test/hook',
    webhookSecret: 'secret',
    notificationChannels: ['SMS'],
    trackingHistoryRetentionDays: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const vendorProfile = {
    create: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const vendorTrackingSettings = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  const prisma = {
    vendorProfile,
    vendorTrackingSettings,
  } as unknown as PrismaService;
  const repository = new VendorProfileRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [
      'creates a profile and normalizes omitted optional fields',
      { businessName: 'New vendor' },
      { email: null, phone: null, description: null },
    ],
    [
      'preserves supplied profile fields',
      {
        businessName: 'New vendor',
        email: 'vendor@example.test',
        phone: '+2348000000000',
        description: 'Reliable goods',
      },
      {
        email: 'vendor@example.test',
        phone: '+2348000000000',
        description: 'Reliable goods',
      },
    ],
  ])('%s', async (_name, dto, expectedOptionalFields) => {
    vendorProfile.create.mockResolvedValue({ ...profile, ...dto });

    const created = await repository.create('vendor-1', dto);

    expect(created.businessName).toBe('New vendor');
    expect(vendorProfile.create).toHaveBeenCalledWith({
      data: {
        address: 'vendor-1',
        businessName: 'New vendor',
        ...expectedOptionalFields,
      },
    });
  });

  it('finds by address and delegates partial updates to that address', async () => {
    vendorProfile.findUnique.mockResolvedValue(profile);
    vendorProfile.update.mockResolvedValue({
      ...profile,
      businessName: 'Updated',
    });

    await expect(repository.findByAddress('vendor-1')).resolves.toEqual(
      profile,
    );
    await expect(
      repository.update('vendor-1', { businessName: 'Updated' }),
    ).resolves.toMatchObject({ businessName: 'Updated' });
    expect(vendorProfile.findUnique).toHaveBeenCalledWith({
      where: { address: 'vendor-1' },
    });
    expect(vendorProfile.update).toHaveBeenCalledWith({
      where: { address: 'vendor-1' },
      data: { businessName: 'Updated' },
    });
  });

  it('upserts with complete create data and the same mutable update data', async () => {
    const dto = {
      businessName: 'Updated vendor',
      email: 'updated@example.test',
    };
    vendorProfile.upsert.mockResolvedValue({ ...profile, ...dto });

    await expect(repository.upsert('vendor-1', dto)).resolves.toMatchObject(
      dto,
    );

    expect(vendorProfile.upsert).toHaveBeenCalledWith({
      where: { address: 'vendor-1' },
      create: { address: 'vendor-1', ...dto, phone: null, description: null },
      update: { ...dto, phone: null, description: null },
    });
  });

  it.each([
    [
      'creates settings with defaults',
      {},
      {
        notifyOnDelivery: true,
        notifyOnDelay: true,
        notifyOnException: true,
        notificationChannels: ['EMAIL'],
        webhookUrl: null,
        webhookSecret: null,
      },
      {},
    ],
    [
      'updates only supplied preferences including false and null',
      {
        notifyOnDelivery: false,
        notifyOnDelay: false,
        notifyOnException: false,
        notificationChannels: ['SMS'],
        webhookUrl: 'https://updated.example.test/hook',
        webhookSecret: 'new-secret',
      },
      {
        notifyOnDelivery: false,
        notifyOnDelay: false,
        notifyOnException: false,
        notificationChannels: ['SMS'],
        webhookUrl: 'https://updated.example.test/hook',
        webhookSecret: 'new-secret',
      },
      {
        notifyOnDelivery: false,
        notifyOnDelay: false,
        notifyOnException: false,
        notificationChannels: ['SMS'],
        webhookUrl: 'https://updated.example.test/hook',
        webhookSecret: 'new-secret',
      },
    ],
  ])('%s', async (_name, dto, expectedCreate, expectedUpdate) => {
    vendorTrackingSettings.upsert.mockResolvedValue(trackingSettings);

    const result = await repository.updateNotificationPreferences(
      'vendor-1',
      dto,
    );

    expect(result.trackingSettings).toMatchObject({
      vendorAddress: 'vendor-1',
      notificationChannels: ['SMS'],
    });
    expect(vendorTrackingSettings.upsert).toHaveBeenCalledWith({
      where: { vendorAddress: 'vendor-1' },
      create: { vendorAddress: 'vendor-1', ...expectedCreate },
      update: expectedUpdate,
    });
  });

  it.each([
    [
      'uses platform defaults when settings are absent',
      null,
      {
        notifyOnDelivery: true,
        notifyOnDelay: true,
        notifyOnException: true,
        notificationChannels: ['EMAIL'],
        webhookUrl: null,
        enableTracking: true,
        delayThresholdHours: 24,
        deliveryConfirmation: true,
        trackingHistoryRetentionDays: 90,
      },
    ],
    [
      'returns configured settings',
      trackingSettings,
      {
        notifyOnDelivery: false,
        notifyOnDelay: false,
        notifyOnException: false,
        notificationChannels: ['SMS'],
        webhookUrl: 'https://example.test/hook',
        enableTracking: false,
        delayThresholdHours: 36,
        deliveryConfirmation: false,
        trackingHistoryRetentionDays: 30,
      },
    ],
  ])('%s', async (_name, settings, expected) => {
    vendorTrackingSettings.findUnique.mockResolvedValue(settings);

    await expect(
      repository.findNotificationPreferences('vendor-1'),
    ).resolves.toEqual(expected);
    expect(vendorTrackingSettings.findUnique).toHaveBeenCalledWith({
      where: { vendorAddress: 'vendor-1' },
    });
  });
});
