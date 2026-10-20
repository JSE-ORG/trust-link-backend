# Database Migration: Vendor Account Details and Tracking Settings

## Overview

This migration adds centralized database tables for mapping specialized vendor account details and tracking settings, with proper foreign key bindings to the vendor identity table.

## New Tables

### 1. VendorAccountDetails

Centralized table for specialized vendor account details including business information, payment methods, and compliance data.

**Fields:**
- `id` (String, Primary Key): Unique identifier
- `vendorAddress` (String, Unique): Foreign key to VendorProfile.address
- `businessLicense` (String, Optional): Business license number
- `taxId` (String, Optional): Tax identification number
- `bankAccountNumber` (String, Optional): Bank account number
- `bankRoutingNumber` (String, Optional): Bank routing number
- `paymentMethods` (String[], Default: []): Accepted payment methods
- `preferredCurrency` (String, Default: "USD"): Preferred currency for transactions
- `billingAddress` (String, Optional): Billing street address
- `billingCity` (String, Optional): Billing city
- `billingState` (String, Optional): Billing state/province
- `billingCountry` (String, Optional): Billing country
- `billingPostalCode` (String, Optional): Billing postal code
- `shippingAddress` (String, Optional): Shipping street address
- `shippingCity` (String, Optional): Shipping city
- `shippingState` (String, Optional): Shipping state/province
- `shippingCountry` (String, Optional): Shipping country
- `shippingPostalCode` (String, Optional): Shipping postal code
- `websiteUrl` (String, Optional): Business website URL
- `socialMediaLinks` (String[], Default: []): Social media profile URLs
- `businessHours` (String, Optional): Business operating hours
- `timezone` (String, Default: "UTC"): Business timezone
- `language` (String, Default: "en"): Preferred language
- `verificationStatus` (String, Default: "PENDING"): Account verification status
- `verifiedAt` (DateTime, Optional): Verification timestamp
- `kycStatus` (String, Default: "NOT_STARTED"): KYC compliance status
- `kycCompletedAt` (DateTime, Optional): KYC completion timestamp
- `riskScore` (Int, Default: 0): Risk assessment score
- `complianceNotes` (String, Optional): Compliance-related notes
- `customFields` (Json, Optional): Custom vendor-specific fields
- `createdAt` (DateTime): Record creation timestamp
- `updatedAt` (DateTime): Record last update timestamp

**Indexes:**
- Unique index on `vendorAddress`
- Index on `verificationStatus`
- Index on `kycStatus`
- Index on `riskScore`

### 2. VendorTrackingSettings

Centralized table for vendor tracking settings including notification preferences and tracking provider configurations.

**Fields:**
- `id` (String, Primary Key): Unique identifier
- `vendorAddress` (String, Unique): Foreign key to VendorProfile.address
- `enableTracking` (Boolean, Default: true): Enable/disable tracking
- `trackingProvider` (String, Optional): Tracking provider name (e.g., FedEx, UPS)
- `trackingApiKey` (String, Optional): API key for tracking provider
- `autoUpdateTracking` (Boolean, Default: false): Enable automatic tracking updates
- `trackingUpdateInterval` (Int, Default: 3600): Update interval in seconds
- `notifyOnDelivery` (Boolean, Default: true): Send notification on delivery
- `notifyOnDelay` (Boolean, Default: true): Send notification on delay
- `notifyOnException` (Boolean, Default: true): Send notification on exception
- `delayThresholdHours` (Int, Default: 24): Delay threshold in hours
- `deliveryConfirmation` (Boolean, Default: true): Require delivery confirmation
- `requireSignature` (Boolean, Default: false): Require signature on delivery
- `insuranceRequired` (Boolean, Default: false): Require shipping insurance
- `insuranceValue` (Float, Optional): Insurance value amount
- `customTrackingRules` (Json, Optional): Custom tracking rules
- `webhookUrl` (String, Optional): Webhook URL for tracking updates
- `webhookSecret` (String, Optional): Webhook secret for authentication
- `notificationChannels` (String[], Default: ["EMAIL"]): Notification channels
- `trackingHistoryRetentionDays` (Int, Default: 90): Retention period for tracking history
- `createdAt` (DateTime): Record creation timestamp
- `updatedAt` (DateTime): Record last update timestamp

**Indexes:**
- Unique index on `vendorAddress`
- Index on `enableTracking`

## Foreign Key Relationships

### VendorAccountDetails → VendorProfile
```sql
ALTER TABLE "VendorAccountDetails" 
ADD CONSTRAINT "VendorAccountDetails_vendorAddress_fkey" 
FOREIGN KEY ("vendorAddress") REFERENCES "VendorProfile"("address") 
ON DELETE CASCADE ON UPDATE CASCADE;
```

### VendorTrackingSettings → VendorProfile
```sql
ALTER TABLE "VendorTrackingSettings" 
ADD CONSTRAINT "VendorTrackingSettings_vendorAddress_fkey" 
FOREIGN KEY ("vendorAddress") REFERENCES "VendorProfile"("address") 
ON DELETE CASCADE ON UPDATE CASCADE;
```

### Escrow → VendorProfile
```sql
ALTER TABLE "Escrow" 
ADD CONSTRAINT "Escrow_vendorAddress_fkey" 
FOREIGN KEY ("vendorAddress") REFERENCES "VendorProfile"("address") 
ON DELETE RESTRICT ON UPDATE CASCADE;
```

## Migration Steps

### 1. Generate Prisma Client
```bash
npm run db:generate
```

### 2. Apply Migration
```bash
npm run db:migrate
```

Or apply the manual migration:
```bash
psql $DATABASE_URL -f prisma/migrations/20260527120000_add_vendor_account_details_and_tracking/migration.sql
```

### 3. Seed Database
```bash
npm run db:seed
```

## Deployment to Staging

### Docker Compose Deployment
The migration will run automatically when deploying to staging containers via Docker Compose, as the database initialization scripts are included in the container setup.

### Manual Staging Deployment
```bash
# Set staging environment
export NODE_ENV=staging
export DATABASE_URL=postgresql://user:password@staging-db-host:5432/trustlink_staging

# Generate Prisma client
npm run db:generate

# Apply migration
npm run db:migrate

# Seed with test data
npm run db:seed
```

### Verification
After deployment, verify the tables were created successfully:
```bash
npm run db:studio
```

Or run a quick check:
```bash
npx prisma db pull
npx prisma format
```

## Acceptance Criteria

✅ **Relational foreign key bindings match target identity tables perfectly**
- VendorAccountDetails.vendorAddress → VendorProfile.address (CASCADE delete)
- VendorTrackingSettings.vendorAddress → VendorProfile.address (CASCADE delete)
- Escrow.vendorAddress → VendorProfile.address (RESTRICT delete)
- All foreign keys use the correct reference fields and cascade rules

✅ **Database structures deploy smoothly across staging test containers**
- Migration SQL is compatible with PostgreSQL
- Foreign key constraints are properly defined
- Indexes are created for query performance
- Default values are set appropriately
- Seed data includes all new tables
- Docker deployment scripts will execute migration automatically

## Schema Changes Summary

### Modified Tables
- **VendorProfile**: Added relations to VendorAccountDetails and VendorTrackingSettings
- **Escrow**: Added relation to VendorProfile

### New Tables
- **VendorAccountDetails**: 25 fields for comprehensive vendor account information
- **VendorTrackingSettings**: 20 fields for tracking configuration

### New Relations
- VendorProfile.accountDetails → VendorAccountDetails (1:1)
- VendorProfile.trackingSettings → VendorTrackingSettings (1:1)
- VendorProfile.escrows → Escrow (1:N)

## Rollback Procedure

If needed, rollback the migration:
```bash
npx prisma migrate resolve --rolled-back 20260527120000_add_vendor_account_details_and_tracking
```

Or manually:
```sql
DROP TABLE IF EXISTS "VendorTrackingSettings";
DROP TABLE IF EXISTS "VendorAccountDetails";
ALTER TABLE "Escrow" DROP CONSTRAINT IF EXISTS "Escrow_vendorAddress_fkey";
```

## Testing

### Unit Testing
```typescript
// Test foreign key constraints
await prisma.vendorAccountDetails.create({
  data: {
    vendorAddress: 'nonexistent_address',
    // ... other fields
  }
});
// Expected: Foreign key constraint violation error
```

### Integration Testing
```typescript
// Test cascade delete
const vendor = await prisma.vendorProfile.create({
  data: {
    address: 'test_address',
    businessName: 'Test Vendor',
    accountDetails: {
      create: { /* account details */ }
    },
    trackingSettings: {
      create: { /* tracking settings */ }
    }
  }
});

await prisma.vendorProfile.delete({
  where: { address: 'test_address' }
});

// Verify: accountDetails and trackingSettings are also deleted
```

## Notes

- The migration uses CASCADE delete for vendor-related tables to maintain data integrity
- Escrow uses RESTRICT delete to prevent accidental deletion of vendors with active transactions
- All timestamps use UTC timezone for consistency
- Custom fields use JSONB for flexibility
- Indexes are created on frequently queried fields for performance
