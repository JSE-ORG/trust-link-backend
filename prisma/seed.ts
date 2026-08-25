import { PrismaService } from '../src/prisma/prisma.service';

type EscrowState =
  | 'CREATED'
  | 'FUNDED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'RELEASED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'CANCELLED';

type DisputeState =
  'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CANCELLED' | 'ABANDONED';

// Deterministic Stellar-like public keys for vendors and buyers
const VENDORS = [
  'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6',
  'GBRPDO4JDHPUC253QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND',
  'GC2Y4F5HJK56TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND782L5N',
];

const BUYERS = [
  'GDBW53QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY18274L2P',
  'GDC46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY28274L2P981N',
  'GDDQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY38274L2P981N2893',
  'GDE6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY48274L2P981N289311',
  'GDF7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY58274L2P981N28931102',
];

export const EXPECTED_COUNTS = {
  escrows: 15,
  disputes: 3,
  notifications: 10,
};

async function seedVendors(p: PrismaService): Promise<void> {
  for (const address of VENDORS) {
    await p.vendorProfile.upsert({
      where: { address },
      create: {
        address,
        businessName: `Vendor ${address.slice(0, 6)}`,
      },
      update: {},
    });
  }
}

async function seedEscrows(
  p: PrismaService,
): Promise<{ created: number; updated: number; ids: string[] }> {
  const states: EscrowState[] = [
    'CREATED',
    'FUNDED',
    'SHIPPED',
    'DELIVERED',
    'COMPLETED',
  ];

  const escrowRefs: string[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < 15; i++) {
    const state = states[Math.floor(i / 3)];
    const vendorAddress = VENDORS[i % VENDORS.length];
    const buyerAddress = BUYERS[i % BUYERS.length];
    const amount = (100.5 + i * 50).toFixed(4);
    const itemRef = `REF-DET-${1000 + i}`;

    // Matched on the full unique key. `itemRef` alone is not unique — the
    // schema declares @@unique([vendorAddress, itemRef]) — so looking it up on
    // its own could match another vendor's row, skip the wrong escrow, and
    // then violate the constraint on create.
    const existing = await p.escrow.findUnique({
      where: { vendorAddress_itemRef: { vendorAddress, itemRef } },
    });

    if (existing) {
      escrowRefs.push(existing.id);
      updated++;
    } else {
      const result = await p.escrow.create({
        data: {
          itemName: `Item #${i + 1}`,
          itemRef,
          amount: Number(amount),
          currency: 'USD',
          buyerAddress,
          vendorAddress,
          state,
          trackingId:
            state === 'SHIPPED' ||
            state === 'DELIVERED' ||
            state === 'COMPLETED'
              ? `TRK-${2000 + i}`
              : null,
          shippedAt:
            state === 'SHIPPED' ||
            state === 'DELIVERED' ||
            state === 'COMPLETED'
              ? new Date()
              : null,
        },
      });
      escrowRefs.push(result.id);
      created++;
    }
  }

  return { created, updated, ids: escrowRefs };
}

async function seedDisputes(
  p: PrismaService,
  escrowIds: string[],
): Promise<{ created: number; updated: number }> {
  const disputes: { escrowId: string; status: DisputeState; reason: string }[] =
    [
      { escrowId: escrowIds[0], status: 'OPEN', reason: 'Item not received' },
      { escrowId: escrowIds[1], status: 'OPEN', reason: 'Damaged packaging' },
      {
        escrowId: escrowIds[2],
        status: 'RESOLVED',
        reason: 'Defective item, resolved by refund',
      },
    ];

  let created = 0;
  let updated = 0;

  for (const dispute of disputes) {
    const existing = await p.dispute.findFirst({
      where: { escrowId: dispute.escrowId },
    });
    if (existing) {
      updated++;
    } else {
      await p.dispute.create({ data: dispute });
      created++;
    }
  }

  return { created, updated };
}

async function seedNotifications(
  p: PrismaService,
  escrowIds: string[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const existingNotifications = await p.notification.findMany();

  for (let i = 0; i < 10; i++) {
    const recipientAddress = BUYERS[i % BUYERS.length];
    const message = `Notification for Escrow state change event #${i + 1}`;
    const escrowId = escrowIds[i % escrowIds.length];

    const exists = existingNotifications.some(
      (n) =>
        n.escrowId === escrowId &&
        n.recipientAddress === recipientAddress &&
        n.message === message,
    );

    if (exists) {
      updated++;
    } else {
      await p.notification.create({
        data: {
          escrowId,
          type: 'SHIPPED',
          channel: 'EMAIL',
          recipientAddress,
          message,
        },
      });
      created++;
    }
  }

  return { created, updated };
}

export async function main(p?: PrismaService) {
  const prisma = p ?? new PrismaService();
  try {
    console.log('Starting database seed...');

    await seedVendors(prisma);
    console.log(`Vendors: ${VENDORS.length} ensured`);

    const {
      created: escrowsCreated,
      updated: escrowsUpdated,
      ids: escrowIds,
    } = await seedEscrows(prisma);
    console.log(
      `Escrows: ${escrowsCreated} created, ${escrowsUpdated} updated`,
    );

    const { created: disputesCreated, updated: disputesUpdated } =
      await seedDisputes(prisma, escrowIds);
    console.log(
      `Disputes: ${disputesCreated} created, ${disputesUpdated} updated`,
    );

    const { created: notificationsCreated, updated: notificationsUpdated } =
      await seedNotifications(prisma, escrowIds);
    console.log(
      `Notifications: ${notificationsCreated} created, ${notificationsUpdated} updated`,
    );

    const [escrows, disputes, notifications] = await Promise.all([
      prisma.escrow.findMany(),
      prisma.dispute.findMany(),
      prisma.notification.findMany(),
    ]);

    console.log('\nSeed summary:');
    console.log(`  Escrows: ${escrows.length}`);
    console.log(`  Disputes: ${disputes.length}`);
    console.log(`  Notifications: ${notifications.length}`);
    console.log('Seeding completed successfully!');
  } catch (error) {
    // Rethrown rather than exiting: main() is imported and called by
    // test/seed.spec.ts, and process.exit there kills the Jest worker
    // mid-run, taking down unrelated suites with no summary. Exiting is the
    // CLI entrypoint's job, below.
    console.error('Seeding failed:', error);
    throw error;
  }
}

// Only run when invoked directly (`npm run db:seed`). Importing this module —
// as the spec does, to call main(prisma) with its own client — must not
// trigger a second, concurrent seed against the default connection.
if (require.main === module) {
  main().catch(() => process.exit(1));
}
