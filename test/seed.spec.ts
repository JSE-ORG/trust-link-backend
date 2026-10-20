import { PrismaService } from '../src/prisma/prisma.service';
import { main, EXPECTED_COUNTS } from '../prisma/seed';

describe('Database Seed', () => {
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  it('produces the expected number of escrows, disputes, and notifications', async () => {
    await main(prisma);

    const [escrows, disputes, notifications] = await Promise.all([
      prisma.escrow.findMany(),
      prisma.dispute.findMany(),
      prisma.notification.findMany(),
    ]);

    expect(escrows.length).toBe(EXPECTED_COUNTS.escrows);
    expect(disputes.length).toBe(EXPECTED_COUNTS.disputes);
    expect(notifications.length).toBe(EXPECTED_COUNTS.notifications);
  });

  it('running the seed twice leaves the same counts', async () => {
    await main(prisma);
    await main(prisma);

    const [escrows, disputes, notifications] = await Promise.all([
      prisma.escrow.findMany(),
      prisma.dispute.findMany(),
      prisma.notification.findMany(),
    ]);

    expect(escrows.length).toBe(EXPECTED_COUNTS.escrows);
    expect(disputes.length).toBe(EXPECTED_COUNTS.disputes);
    expect(notifications.length).toBe(EXPECTED_COUNTS.notifications);
  });
});
