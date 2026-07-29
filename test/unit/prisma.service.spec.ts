import { Test } from '@jest/globals';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('PrismaService real database operations', () => {
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  it('create/findUnique/findMany/update for escrow and updateMany behavior', async () => {
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

    const found = await prisma.escrow.findUnique({ where: { id: 'e2' } });
    expect(found).not.toBeNull();
    expect(found!.id).toBe('e2');

    const results = await prisma.escrow.findMany({
      where: { vendorAddress: 'v1' },
      orderBy: { createdAt: 'asc' },
      skip: 1,
      take: 2,
    });
    expect(results.map((r) => r.id)).toEqual(['e2', 'e3']);

    const cursorResults = await prisma.escrow.findMany({
      where: { vendorAddress: 'v1' },
      orderBy: { createdAt: 'asc' },
      cursor: { id: 'e1' },
      skip: 1,
    });
    expect(cursorResults.map((r) => r.id)).toEqual(['e2', 'e3']);

    const res = await prisma.escrow.updateMany({ where: { id: 'e2' }, data: { autoReleaseSubmittedAt: new Date() } });
    expect(res.count).toBe(1);

    const res0 = await prisma.escrow.updateMany({ where: { id: 'nope' }, data: { autoReleaseSubmittedAt: new Date() } });
    expect(res0.count).toBe(0);
  });

  it('dispute.create creates a dispute linked to an escrow', async () => {
    await prisma.escrow.create({ data: { id: 'e10', itemName: 'X', itemRef: 'rx', amount: 5, currency: 'USD', buyerAddress: 'b', vendorAddress: 'v', createdAt: new Date() } });
    const dispute = await prisma.dispute.create({ data: { escrowId: 'e10', reason: 'reason', description: 'd', evidenceUrls: [] } });
    expect(dispute.escrowId).toBe('e10');
  });

  it('reset clears all stores', async () => {
    await prisma.escrow.create({ data: { id: 'to-delete', itemName: 'ToDel', itemRef: 'r', amount: 1, currency: 'USD', buyerAddress: 'b', vendorAddress: 'v' } });
    await prisma.reset();
    const e = await prisma.escrow.findUnique({ where: { id: 'to-delete' } });
    expect(e).toBeNull();
  });

  it('update and findMany for notification works', async () => {
    await prisma.escrow.create({ data: { id: 'e-nt', itemName: 'N', itemRef: 'nr', amount: 10, currency: 'USD', buyerAddress: 'b', vendorAddress: 'v' } });
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

  it('refresh token create works', async () => {
    const t1 = await prisma.refreshToken.create({ data: { userId: 'u1', tokenHash: 'h1', parentTokenId: null, revoked: false, expiresAt: new Date() } });
    expect(t1.id).toBeDefined();
    expect(t1.revoked).toBe(false);
  });

  it('nonce create and findUnique works', async () => {
    const n1 = await prisma.nonce.create({ data: { nonce: 'n1', walletAddress: 'w1', challenge: 'c', used: false, expiresAt: new Date(Date.now() + 60000) } });
    expect(n1.id).toBeDefined();
    expect(n1.nonce).toBe('n1');
  });

  it('failedTransaction create/findMany/update works', async () => {
    const f = await prisma.failedTransaction.create({ data: { operation: 'op', escrowId: null, errorMessage: 'err', ledgerFeedback: null, attempts: 0, status: 'PENDING_REVIEW' } });
    const found = await prisma.failedTransaction.findMany();
    expect(found.map((r) => r.id)).toContain(f.id);
    const updated = await prisma.failedTransaction.update({ where: { id: f.id }, data: { errorMessage: 'new' } });
    expect(updated.errorMessage).toBe('new');
  });
});
