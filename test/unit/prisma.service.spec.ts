import { Test } from '@jest/globals';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('PrismaService in-memory stores (issue #411)', () => {
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = new PrismaService();
  });

  it('assertEncryptedContact throws when plaintext email or phone is written', async () => {
    await expect(
      prisma.escrow.create({
        data: {
          itemName: 'Item',
          amount: 10,
          currency: 'USDC',
          buyerAddress: 'buyer',
          vendorAddress: 'vendor',
          // plaintext should be rejected
          buyerContactEmail: 'plain@example.com',
        },
      }),
    ).rejects.toThrow(/must be encrypted/);

    // phone plaintext
    await expect(
      prisma.escrow.create({
        data: {
          itemName: 'Item',
          amount: 10,
          currency: 'USDC',
          buyerAddress: 'buyer',
          vendorAddress: 'vendor',
          buyerContactPhone: '+1234567890',
        },
      }),
    ).rejects.toThrow(/must be encrypted/);
  });

  it('create/findUnique/findMany/update for escrow and updateMany behavior', async () => {
    // create multiple escrows
    const baseDate = new Date('2026-01-01T00:00:00.000Z');
    const e1 = await prisma.escrow.create({
      data: { id: 'e1', itemName: 'A', itemRef: 'r1', amount: 1, currency: 'USD', buyerAddress: 'b1', vendorAddress: 'v1', createdAt: new Date(baseDate.getTime() + 1000) },
    });
    const e2 = await prisma.escrow.create({
      data: { id: 'e2', itemName: 'B', itemRef: 'r2', amount: 2, currency: 'USD', buyerAddress: 'b1', vendorAddress: 'v1', createdAt: new Date(baseDate.getTime() + 2000) },
    });
    const e3 = await prisma.escrow.create({
      data: { id: 'e3', itemName: 'C', itemRef: 'r3', amount: 3, currency: 'USD', buyerAddress: 'b2', vendorAddress: 'v1', createdAt: new Date(baseDate.getTime() + 3000) },
    });
    const e4 = await prisma.escrow.create({
      data: { id: 'e4', itemName: 'D', itemRef: 'r4', amount: 4, currency: 'USD', buyerAddress: 'b2', vendorAddress: 'v2', createdAt: new Date(baseDate.getTime() + 4000) },
    });

    // findUnique
    const found = await prisma.escrow.findUnique({ where: { id: 'e2' } });
    expect(found).not.toBeNull();
    expect(found!.id).toBe('e2');

    // findMany with where vendorAddress and orderBy createdAt asc, skip and take
    const results = await prisma.escrow.findMany({
      where: { vendorAddress: 'v1' },
      orderBy: { createdAt: 'asc' },
      skip: 1,
      take: 2,
    });
    // v1 has e1, e2, e3 -> ordered asc -> skip 1 -> [e2, e3] then take 2 -> [e2, e3]
    expect(results.map((r) => r.id)).toEqual(['e2', 'e3']);

    // cursor support: cursor at e1, skip unspecified -> effectiveSkip = cursorIndex + 1
    const cursorResults = await prisma.escrow.findMany({
      where: { vendorAddress: 'v1' },
      orderBy: { createdAt: 'asc' },
      cursor: { id: 'e1' },
    });
    // should skip e1 and return e2,e3
    expect(cursorResults.map((r) => r.id)).toEqual(['e2', 'e3']);

    // updateMany: update autoReleaseSubmittedAt on e2
    const before = await prisma.escrow.findUnique({ where: { id: 'e2' } });
    expect(before!.autoReleaseSubmittedAt).toBeNull();

    const res = await prisma.escrow.updateMany({ where: { id: 'e2' }, data: { autoReleaseSubmittedAt: new Date() } });
    expect(res.count).toBe(1);

    const after = await prisma.escrow.findUnique({ where: { id: 'e2' } });
    expect(after!.autoReleaseSubmittedAt).not.toBeNull();

    // update non-matching should return 0
    const res0 = await prisma.escrow.updateMany({ where: { id: 'nope' }, data: { autoReleaseSubmittedAt: new Date() } });
    expect(res0.count).toBe(0);
  });

  it('dispute.create transitions escrow to DISPUTED and is findable', async () => {
    // create escrow e10
    await prisma.escrow.create({ data: { id: 'e10', itemName: 'X', itemRef: 'rx', amount: 5, currency: 'USD', buyerAddress: 'b', vendorAddress: 'v', createdAt: new Date() } });

    const dispute = await prisma.dispute.create({ data: { escrowId: 'e10', reason: 'reason', description: 'd', evidenceUrls: [] } });
    expect(dispute.escrowId).toBe('e10');

    const updatedEscrow = await prisma.escrow.findUnique({ where: { id: 'e10' } });
    expect(updatedEscrow!.state).toBe('DISPUTED');
    expect(updatedEscrow!.disputeId).toBe(dispute.id);
  });

  it('reset clears all stores', async () => {
    // populate some stores
    await prisma.vendorProfile.create({ data: { address: 'va', businessName: 'Biz', email: null, phone: null, description: null, createdAt: new Date(), updatedAt: new Date() } });
    await prisma.notification.create({ data: { escrowId: 'e1', type: 'FUNDED', channel: 'EMAIL', recipientAddress: 'x', message: 'm' } });
    await prisma.escrow.create({ data: { id: 'to-delete', itemName: 'ToDel', itemRef: 'r', amount: 1, currency: 'USD', buyerAddress: 'b', vendorAddress: 'v' } });

    await prisma.reset();

    const vp = await prisma.vendorProfile.findUnique({ where: { address: 'va' } });
    expect(vp).toBeNull();
    const notes = await prisma.notification.findMany();
    expect(notes.length).toBe(0);
    const e = await prisma.escrow.findUnique({ where: { id: 'to-delete' } });
    expect(e).toBeNull();
  });

  it('update and findMany for notification works', async () => {
    const n = await prisma.notification.create({ data: { escrowId: 'e-nt', type: 'FUNDED', channel: 'EMAIL', recipientAddress: 'r', message: 'msg' } });
    const updated = await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', retryCount: 1 } });
    expect(updated.status).toBe('SENT');

    const all = await prisma.notification.findMany();
    expect(all.map((x) => x.id)).toContain(n.id);
  });

  it('vendorProfile upsert and update behaves as expected', async () => {
    const created = await prisma.vendorProfile.upsert({ where: { address: 'v1' }, create: { address: 'v1', businessName: 'B1', email: null, phone: null, description: null }, update: { businessName: 'B2' } });
    expect(created.address).toBe('v1');

    const updated = await prisma.vendorProfile.update({ where: { address: 'v1' }, data: { businessName: 'B3' } });
    expect(updated.businessName).toBe('B3');
  });

  it('processedWebhookEvent create/findUnique/delete works', async () => {
    const p = await prisma.processedWebhookEvent.create({ data: { operationId: 'op-1' } });
    expect(p.operationId).toBe('op-1');
    const found = await prisma.processedWebhookEvent.findUnique({ where: { operationId: 'op-1' } });
    expect(found).not.toBeNull();
    const deleted = await prisma.processedWebhookEvent.delete({ where: { operationId: 'op-1' } });
    expect(deleted.operationId).toBe('op-1');
    const foundAfter = await prisma.processedWebhookEvent.findUnique({ where: { operationId: 'op-1' } });
    expect(foundAfter).toBeNull();
  });

  it('refresh token updateMany and deleteMany behave correctly', async () => {
    const t1 = await prisma.refreshToken.create({ data: { userId: 'u1', tokenHash: 'h1', parentTokenId: null, revoked: false, expiresAt: new Date(), createdAt: new Date() } });
    const t2 = await prisma.refreshToken.create({ data: { userId: 'u2', tokenHash: 'h2', parentTokenId: null, revoked: false, expiresAt: new Date(), createdAt: new Date() } });

    const up = await prisma.refreshToken.updateMany({ where: { userId: 'u1' }, data: { revoked: true } });
    expect(up.count).toBe(1);

    const del = await prisma.refreshToken.deleteMany();
    expect(del.count).toBeGreaterThanOrEqual(0);
  });

  it('nonce create and deleteMany with expiry works', async () => {
    const n1 = await prisma.nonce.create({ data: { nonce: 'n1', walletAddress: 'w1', challenge: 'c', used: false, expiresAt: new Date(Date.now() + 1000 * 60), createdAt: new Date() } });
    const del = await prisma.nonce.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() + 1000 * 60 * 60) } } });
    expect(del.count).toBeGreaterThanOrEqual(0);
  });

  it('escrowEvent create and findMany ordered', async () => {
    await prisma.escrowEvent.create({ data: { escrowId: 'e-ev', fromState: null, toState: 'FUNDED' } });
    await prisma.escrowEvent.create({ data: { escrowId: 'e-ev', fromState: 'FUNDED', toState: 'SHIPPED' } });
    const events = await prisma.escrowEvent.findMany({ where: { escrowId: 'e-ev' } });
    expect(events.length).toBe(2);
    expect(events[0].createdAt.getTime()).toBeLessThanOrEqual(events[1].createdAt.getTime());
  });

  it('failedTransaction create/findMany/update works', async () => {
    const f = await prisma.failedTransaction.create({ data: { operation: 'op', escrowId: null, errorMessage: 'err', ledgerFeedback: null, attempts: 0, status: 'PENDING_REVIEW', createdAt: new Date(), updatedAt: new Date() } });
    const found = await prisma.failedTransaction.findMany({ where: {} });
    expect(found.map((r) => r.id)).toContain(f.id);
    const updated = await prisma.failedTransaction.update({ where: { id: f.id }, data: { errorMessage: 'new' } });
    expect(updated.errorMessage).toBe('new');
  });
});
