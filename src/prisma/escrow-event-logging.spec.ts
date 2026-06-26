import { PrismaService } from './prisma.service';
import { EscrowRepository } from '../escrow/escrow.repository';

// #71 (EscrowEvent model + event logging) and #72 (log every state transition).
// State changes funnel through PrismaService's escrow create/update + the
// dispute side-effect, so the audit log is written for every transition.
describe('Escrow state-transition logging (#71/#72)', () => {
  let prisma: PrismaService;

  const baseEscrow = {
    itemName: 'Widget',
    itemRef: 'ref-1',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'GBUYER',
    vendorAddress: 'GVENDOR',
  };

  beforeEach(() => {
    prisma = new PrismaService();
  });

  it('records the initial FUNDED creation event', async () => {
    const escrow = await prisma.escrow.create({ data: baseEscrow });

    const events = await prisma.escrowEvent.findMany({
      where: { escrowId: escrow.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromState: null, toState: 'FUNDED' });
  });

  it('records a transition with from/to state on every state change', async () => {
    const escrow = await prisma.escrow.create({ data: baseEscrow });
    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { state: 'SHIPPED' },
    });
    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { state: 'COMPLETED' },
    });

    const events = await prisma.escrowEvent.findMany({
      where: { escrowId: escrow.id },
    });
    expect(events.map((e) => [e.fromState, e.toState])).toEqual([
      [null, 'FUNDED'],
      ['FUNDED', 'SHIPPED'],
      ['SHIPPED', 'COMPLETED'],
    ]);
  });

  it('does not record an event when the update leaves state unchanged', async () => {
    const escrow = await prisma.escrow.create({ data: baseEscrow });
    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { trackingId: 'TRACK-1' },
    });
    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { state: 'FUNDED' }, // same state — no transition
    });

    const events = await prisma.escrowEvent.findMany({
      where: { escrowId: escrow.id },
    });
    expect(events).toHaveLength(1); // only the creation event
  });

  it('records a DISPUTED transition when a dispute is opened', async () => {
    const escrow = await prisma.escrow.create({ data: baseEscrow });
    await prisma.dispute.create({
      data: { escrowId: escrow.id, reason: 'item not received' },
    });

    const events = await prisma.escrowEvent.findMany({
      where: { escrowId: escrow.id },
    });
    expect(events[events.length - 1]).toMatchObject({
      fromState: 'FUNDED',
      toState: 'DISPUTED',
    });
  });

  it('logs the full lifecycle driven through EscrowRepository', async () => {
    const repo = new EscrowRepository(prisma);
    const escrow = await repo.create(baseEscrow, baseEscrow.vendorAddress);
    await repo.markShipped(escrow.id, 'TRACK-1');
    await repo.markCompleted(escrow.id);

    const events = await prisma.escrowEvent.findMany({
      where: { escrowId: escrow.id },
    });
    expect(events.map((e) => e.toState)).toEqual([
      'FUNDED',
      'SHIPPED',
      'COMPLETED',
    ]);
  });

  it('scopes events per escrow', async () => {
    const a = await prisma.escrow.create({ data: baseEscrow });
    const b = await prisma.escrow.create({ data: baseEscrow });
    await prisma.escrow.update({
      where: { id: a.id },
      data: { state: 'SHIPPED' },
    });

    expect(
      await prisma.escrowEvent.findMany({ where: { escrowId: a.id } }),
    ).toHaveLength(2);
    expect(
      await prisma.escrowEvent.findMany({ where: { escrowId: b.id } }),
    ).toHaveLength(1);
  });
});
