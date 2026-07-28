/**
 * db-seed.ts — populate the database with realistic test data.
 *
 * Idempotent: checks existing record counts before inserting and skips
 * records that are already present so it is safe to run multiple times.
 *
 * Usage:
 *   npm run db:seed
 *   npx ts-node scripts/db-seed.ts
 */
import { PrismaClient, EscrowState, DisputeStatus } from '@prisma/client';

const prisma = new PrismaClient();

// ── Deterministic Stellar-like addresses ────────────────────────────────────
const VENDORS = [
  { address: 'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6', name: 'Stellar Goods Ltd', email: 'vendor1@stellargoods.io', phone: '+1-555-0101', description: 'Premium electronics and gadgets' },
  { address: 'GBRPDO4JDHPUC253QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND', name: 'AgroTech Supplies', email: 'vendor2@agrotech.io', phone: '+1-555-0202', description: 'Agricultural equipment and supplies' },
  { address: 'GC2Y4F5HJK56TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND782L5N', name: 'SafeBox Commerce', email: 'vendor3@safebox.io', phone: '+1-555-0303', description: 'Secure escrow trade for high-value goods' },
];

const BUYERS = [
  'GDBW53QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY18274L2P',
  'GDC46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY28274L2P981N',
  'GDDQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY38274L2P981N2893',
  'GDE6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY48274L2P981N289311',
  'GDF7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY58274L2P981N28931102',
];

// 10 escrows distributed across 6 states per acceptance criteria
const ESCROW_STATES: EscrowState[] = [
  EscrowState.CREATED,
  EscrowState.FUNDED,
  EscrowState.SHIPPED,
  EscrowState.DELIVERED,
  EscrowState.DISPUTED,
  EscrowState.COMPLETED,
  EscrowState.CREATED,
  EscrowState.FUNDED,
  EscrowState.SHIPPED,
  EscrowState.DELIVERED,
];

async function seedVendors(): Promise<void> {
  const existing = await prisma.vendorProfile.count();
  if (existing >= VENDORS.length) {
    console.log(`  vendors: already seeded (${existing} records), skipping`);
    return;
  }
  for (const v of VENDORS) {
    await prisma.vendorProfile.upsert({
      where: { address: v.address },
      update: {},
      create: {
        address: v.address,
        businessName: v.name,
        email: v.email,
        phone: v.phone,
        description: v.description,
        accountDetails: {
          create: {
            businessLicense: `LIC-${v.address.slice(-6)}`,
            taxId: `TAX-${v.address.slice(-4)}`,
          },
        },
        trackingSettings: {
          create: {
            notificationChannels: ['EMAIL', 'WEBHOOK'],
          },
        },
      },
    });
  }
  console.log(`  vendors: seeded ${VENDORS.length} records`);
}

async function seedEscrows(): Promise<string[]> {
  const existing = await prisma.escrow.count();
  if (existing >= ESCROW_STATES.length) {
    console.log(`  escrows: already seeded (${existing} records), skipping`);
    const rows = await prisma.escrow.findMany({ select: { id: true }, take: ESCROW_STATES.length });
    return rows.map(r => r.id);
  }

  const ids: string[] = [];
  const now = new Date();

  for (let i = 0; i < ESCROW_STATES.length; i++) {
    const state = ESCROW_STATES[i];
    const vendor = VENDORS[i % VENDORS.length];
    const buyerAddress = BUYERS[i % BUYERS.length];
    const shipped = state === EscrowState.SHIPPED || state === EscrowState.DELIVERED || state === EscrowState.COMPLETED || state === EscrowState.DISPUTED;

    const escrow = await prisma.escrow.create({
      data: {
        itemName: `Sample Item ${i + 1}`,
        itemRef: `REF-SEED-${1000 + i}`,
        amount: (50 + i * 75).toFixed(4),
        currency: 'USDC',
        buyerAddress,
        vendorAddress: vendor.address,
        state,
        trackingId: shipped ? `TRK-SEED-${2000 + i}` : null,
        shippedAt: shipped ? now : null,
      },
    });
    ids.push(escrow.id);
  }
  console.log(`  escrows: seeded ${ESCROW_STATES.length} records`);
  return ids;
}

async function seedDisputes(escrowIds: string[]): Promise<void> {
  const existing = await prisma.dispute.count();
  if (existing >= 2) {
    console.log(`  disputes: already seeded (${existing} records), skipping`);
    return;
  }
  // Find escrow in DISPUTED state to link dispute to
  const disputedId = escrowIds[ESCROW_STATES.indexOf(EscrowState.DISPUTED)] ?? escrowIds[0];
  const openId = escrowIds[1];

  await prisma.dispute.createMany({
    data: [
      { escrowId: disputedId, status: DisputeStatus.OPEN, reason: 'Item not received by agreed deadline' },
      { escrowId: openId, status: DisputeStatus.RESOLVED, reason: 'Wrong item shipped — resolved by replacement' },
    ],
    skipDuplicates: true,
  });
  console.log('  disputes: seeded 2 records (1 OPEN, 1 RESOLVED)');
}

async function seedNotifications(escrowIds: string[]): Promise<void> {
  const existing = await prisma.notification.count();
  if (existing >= escrowIds.length) {
    console.log(`  notifications: already seeded (${existing} records), skipping`);
    return;
  }
  const types = ['STATE_CHANGE', 'PAYMENT_RECEIVED', 'DISPUTE_OPENED', 'SHIPMENT_UPDATE'];
  const channels = ['EMAIL', 'WEBHOOK'];

  await prisma.notification.createMany({
    data: escrowIds.map((escrowId, i) => ({
      escrowId,
      type: types[i % types.length],
      channel: channels[i % channels.length],
      recipientAddress: BUYERS[i % BUYERS.length],
      message: `Test notification ${i + 1}: ${types[i % types.length]} for escrow`,
    })),
    skipDuplicates: true,
  });
  console.log(`  notifications: seeded ${escrowIds.length} records`);
}

async function main() {
  console.log('Seeding database with test data...\n');

  await seedVendors();
  const escrowIds = await seedEscrows();
  await seedDisputes(escrowIds);
  await seedNotifications(escrowIds);

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
