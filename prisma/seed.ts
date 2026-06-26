import { PrismaClient, EscrowState, DisputeStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check if seeding is already done (idempotency gate)
  const count = await prisma.escrow.count();
  if (count > 0) {
    console.log('Database already seeded. Skipping...');
    return;
  }

  // 1. Generate 3 vendor addresses, 5 buyer addresses (deterministic Stellar-like public keys)
  const vendors = [
    'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6',
    'GBRPDO4JDHPUC253QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND',
    'GC2Y4F5HJK56TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND782L5N',
  ];

  const buyers = [
    'GDBW53QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY18274L2P',
    'GDC46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY28274L2P981N',
    'GDDQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY38274L2P981N2893',
    'GDE6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY48274L2P981N289311',
    'GDF7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY58274L2P981N28931102',
  ];

  // 2. Create exactly 15 escrows distributed evenly across 5 states (3 per state)
  const states: EscrowState[] = [
    EscrowState.CREATED,
    EscrowState.FUNDED,
    EscrowState.SHIPPED,
    EscrowState.DELIVERED,
    EscrowState.COMPLETED,
  ];

  const escrowIds: string[] = [];

  for (let i = 0; i < 15; i++) {
    const state = states[Math.floor(i / 3)];
    const vendorAddress = vendors[i % vendors.length];
    const buyerAddress = buyers[i % buyers.length];
    const amount = (100.5 + i * 50).toFixed(4);

    const escrow = await prisma.escrow.create({
      data: {
        itemName: `Item #${i + 1}`,
        itemRef: `REF-DET-${1000 + i}`,
        amount: amount,
        currency: 'USD',
        buyerAddress,
        vendorAddress,
        state,
        trackingId: state === EscrowState.SHIPPED || state === EscrowState.DELIVERED || state === EscrowState.COMPLETED ? `TRK-${2000 + i}` : null,
        shippedAt: state === EscrowState.SHIPPED || state === EscrowState.DELIVERED || state === EscrowState.COMPLETED ? new Date() : null,
      },
    });
    escrowIds.push(escrow.id);
  }

  // 3. Create 3 disputes (2 OPEN, 1 RESOLVED) linked to valid escrow IDs
  // We link them to some created escrows, for example escrows at index 0, 1, 2
  const dispute1 = await prisma.dispute.create({
    data: {
      escrowId: escrowIds[0],
      status: DisputeStatus.OPEN,
      reason: 'Item not received',
    },
  });

  const dispute2 = await prisma.dispute.create({
    data: {
      escrowId: escrowIds[1],
      status: DisputeStatus.OPEN,
      reason: 'Damaged packaging',
    },
  });

  const dispute3 = await prisma.dispute.create({
    data: {
      escrowId: escrowIds[2],
      status: DisputeStatus.RESOLVED,
      reason: 'Defective item, resolved by refund',
    },
  });

  // Also update these escrows to DISPUTED state to keep consistency, though not strictly required, it matches business logic
  await prisma.escrow.updateMany({
    where: { id: { in: [escrowIds[0], escrowIds[1], escrowIds[2]] } },
    data: { state: EscrowState.DISPUTED },
  });

  // 4. Create 10 notification records linked to escrows or disputes
  for (let i = 0; i < 10; i++) {
    await prisma.notification.create({
      data: {
        escrowId: escrowIds[i % escrowIds.length],
        type: 'STATE_CHANGE',
        channel: 'EMAIL',
        recipientAddress: buyers[i % buyers.length],
        message: `Notification for Escrow state change event #${i + 1}`,
      },
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
