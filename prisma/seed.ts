import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create vendor profile
  const vendorProfile = await prisma.vendorProfile.upsert({
    where: { address: '0xVendorAddress456' },
    update: {},
    create: {
      address: '0xVendorAddress456',
      businessName: 'Tech Solutions Inc',
      email: 'contact@techsolutions.com',
      phone: '+1-555-0123',
      description: 'Leading technology solutions provider',
    },
  });

  // Create vendor account details
  const accountDetails = await prisma.vendorAccountDetails.upsert({
    where: { vendorAddress: '0xVendorAddress456' },
    update: {},
    create: {
      vendorAddress: '0xVendorAddress456',
      businessLicense: 'BL-2024-12345',
      taxId: 'TAX-987654321',
      bankAccountNumber: '****1234',
      bankRoutingNumber: '****5678',
      paymentMethods: ['BANK_TRANSFER', 'CRYPTO'],
      preferredCurrency: 'USD',
      billingAddress: '123 Business Ave',
      billingCity: 'San Francisco',
      billingState: 'CA',
      billingCountry: 'USA',
      billingPostalCode: '94105',
      shippingAddress: '123 Business Ave',
      shippingCity: 'San Francisco',
      shippingState: 'CA',
      shippingCountry: 'USA',
      shippingPostalCode: '94105',
      websiteUrl: 'https://techsolutions.com',
      socialMediaLinks: ['https://twitter.com/techsolutions', 'https://linkedin.com/company/techsolutions'],
      businessHours: 'Mon-Fri 9:00-17:00 UTC',
      timezone: 'America/Los_Angeles',
      language: 'en',
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
      kycStatus: 'COMPLETED',
      kycCompletedAt: new Date(),
      riskScore: 10,
      complianceNotes: 'All compliance checks passed',
    },
  });

  // Create vendor tracking settings
  const trackingSettings = await prisma.vendorTrackingSettings.upsert({
    where: { vendorAddress: '0xVendorAddress456' },
    update: {},
    create: {
      vendorAddress: '0xVendorAddress456',
      enableTracking: true,
      trackingProvider: 'FedEx',
      trackingApiKey: 'fedex_api_key_12345',
      autoUpdateTracking: true,
      trackingUpdateInterval: 1800,
      notifyOnDelivery: true,
      notifyOnDelay: true,
      notifyOnException: true,
      delayThresholdHours: 24,
      deliveryConfirmation: true,
      requireSignature: false,
      insuranceRequired: true,
      insuranceValue: 5000,
      notificationChannels: ['EMAIL', 'SMS'],
      trackingHistoryRetentionDays: 180,
    },
  });

  // Create escrow linked to vendor
  await prisma.escrow.create({
    data: {
      itemName: 'Mock Item 1',
      amount: 100,
      currency: 'USDC',
      buyerAddress: '0xBuyerAddress123',
      vendorAddress: '0xVendorAddress456',
      state: 'FUNDED',
    },
  });

  console.log('Seeding completed!');
  console.log('Created vendor profile:', vendorProfile.businessName);
  console.log('Created account details for vendor:', accountDetails.vendorAddress);
  console.log('Created tracking settings for vendor:', trackingSettings.vendorAddress);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
