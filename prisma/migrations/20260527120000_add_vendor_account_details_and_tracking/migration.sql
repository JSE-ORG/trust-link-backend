-- Migration: Add VendorAccountDetails and VendorTrackingSettings tables
-- This migration creates centralized database tables for vendor account details and tracking settings

-- Create VendorAccountDetails table
CREATE TABLE "VendorAccountDetails" (
    "id" TEXT NOT NULL,
    "vendorAddress" TEXT NOT NULL,
    "businessLicense" TEXT,
    "taxId" TEXT,
    "bankAccountNumber" TEXT,
    "bankRoutingNumber" TEXT,
    "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredCurrency" TEXT NOT NULL DEFAULT 'USD',
    "billingAddress" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingCountry" TEXT,
    "billingPostalCode" TEXT,
    "shippingAddress" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingCountry" TEXT,
    "shippingPostalCode" TEXT,
    "websiteUrl" TEXT,
    "socialMediaLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessHours" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "kycStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "kycCompletedAt" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "complianceNotes" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAccountDetails_pkey" PRIMARY KEY ("id")
);

-- Create unique index on vendorAddress
CREATE UNIQUE INDEX "VendorAccountDetails_vendorAddress_key" ON "VendorAccountDetails"("vendorAddress");

-- Create VendorTrackingSettings table
CREATE TABLE "VendorTrackingSettings" (
    "id" TEXT NOT NULL,
    "vendorAddress" TEXT NOT NULL,
    "enableTracking" BOOLEAN NOT NULL DEFAULT true,
    "trackingProvider" TEXT,
    "trackingApiKey" TEXT,
    "autoUpdateTracking" BOOLEAN NOT NULL DEFAULT false,
    "trackingUpdateInterval" INTEGER NOT NULL DEFAULT 3600,
    "notifyOnDelivery" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnDelay" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnException" BOOLEAN NOT NULL DEFAULT true,
    "delayThresholdHours" INTEGER NOT NULL DEFAULT 24,
    "deliveryConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "requireSignature" BOOLEAN NOT NULL DEFAULT false,
    "insuranceRequired" BOOLEAN NOT NULL DEFAULT false,
    "insuranceValue" DOUBLE PRECISION,
    "customTrackingRules" JSONB,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "notificationChannels" TEXT[] DEFAULT ARRAY['EMAIL']::TEXT[],
    "trackingHistoryRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorTrackingSettings_pkey" PRIMARY KEY ("id")
);

-- Create unique index on vendorAddress
CREATE UNIQUE INDEX "VendorTrackingSettings_vendorAddress_key" ON "VendorTrackingSettings"("vendorAddress");

-- Add foreign key constraint from VendorAccountDetails to VendorProfile
ALTER TABLE "VendorAccountDetails" 
ADD CONSTRAINT "VendorAccountDetails_vendorAddress_fkey" 
FOREIGN KEY ("vendorAddress") REFERENCES "VendorProfile"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key constraint from VendorTrackingSettings to VendorProfile
ALTER TABLE "VendorTrackingSettings" 
ADD CONSTRAINT "VendorTrackingSettings_vendorAddress_fkey" 
FOREIGN KEY ("vendorAddress") REFERENCES "VendorProfile"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes for better query performance
CREATE INDEX "VendorAccountDetails_verificationStatus_idx" ON "VendorAccountDetails"("verificationStatus");
CREATE INDEX "VendorAccountDetails_kycStatus_idx" ON "VendorAccountDetails"("kycStatus");
CREATE INDEX "VendorAccountDetails_riskScore_idx" ON "VendorAccountDetails"("riskScore");
CREATE INDEX "VendorTrackingSettings_enableTracking_idx" ON "VendorTrackingSettings"("enableTracking");

-- Add comment to tables
COMMENT ON TABLE "VendorAccountDetails" IS 'Centralized table for specialized vendor account details including business information, payment methods, and compliance data';
COMMENT ON TABLE "VendorTrackingSettings" IS 'Centralized table for vendor tracking settings including notification preferences and tracking provider configurations';
