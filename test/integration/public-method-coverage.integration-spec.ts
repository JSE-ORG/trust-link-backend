/**
 * Direct tests for public methods no other spec called (issue #1229), run
 * against the real PostgreSQL test database:
 *
 * - Sep10Service.revokeTokenFamily
 * - FailedTransactionRepository.releaseClaim
 * - StellarWebhookRepository.pruneOlderThan (the cleanup job's spec mocks it)
 *
 * EscrowService.findBuyerEscrows and StressTestService.generateTestId have
 * no database dependency and are covered by unit specs next to their sources.
 */
import { Sep10Service } from '../../src/auth/sep10/sep10.service';
import { ConfigService } from '../../src/config/config.service';
import { FailedTransactionRepository } from '../../src/dlq/failed-transaction.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StellarWebhookRepository } from '../../src/webhooks/stellar-webhook.repository';
import { TEST_SIGNING_SECRET } from '../auth-helper';

describe('Public methods without direct tests (issue #1229)', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  afterAll(async () => {
    await prisma.reset();
    await prisma.$disconnect();
  });

  describe('Sep10Service.revokeTokenFamily', () => {
    let service: Sep10Service;

    beforeAll(() => {
      const config = {
        get: jest.fn((key: string) =>
          key === 'SYSTEM_SIGNER_SECRET' ? TEST_SIGNING_SECRET : undefined,
        ),
      } as unknown as ConfigService;
      service = new Sep10Service(config, prisma);
    });

    function createToken(userId: string, tokenHash: string, revoked = false) {
      return prisma.refreshToken.create({
        data: {
          userId,
          tokenHash,
          revoked,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
    }

    it("revokes every refresh token of the token's user and no one else's", async () => {
      const stolen = await createToken('user-a', 'hash-a-1');
      await createToken('user-a', 'hash-a-2');
      await createToken('user-a', 'hash-a-3', true);
      await createToken('user-b', 'hash-b-1');

      await service.revokeTokenFamily(stolen.id);

      const userA = await prisma.refreshToken.findMany({
        where: { userId: 'user-a' },
      });
      expect(userA).toHaveLength(3);
      expect(userA.every((t) => t.revoked)).toBe(true);

      const userB = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: 'hash-b-1' },
      });
      expect(userB.revoked).toBe(false);
    });

    it('does nothing for an unknown token id', async () => {
      await createToken('user-a', 'hash-a-1');

      await expect(
        service.revokeTokenFamily('no-such-token'),
      ).resolves.toBeUndefined();

      const token = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: 'hash-a-1' },
      });
      expect(token.revoked).toBe(false);
    });
  });

  describe('FailedTransactionRepository.releaseClaim', () => {
    let repo: FailedTransactionRepository;

    beforeAll(() => {
      repo = new FailedTransactionRepository(prisma);
    });

    it('returns a claimed row to PENDING_REVIEW so it can be claimed again', async () => {
      const created = await repo.create({
        operation: 'submitAutoRelease',
        escrowId: 'escrow-1',
        errorMessage: 'Stellar network timeout',
      });
      const claimed = await repo.claimForReplay(created.id);
      expect(claimed?.status).toBe('REPLAYING');

      const released = await repo.releaseClaim(created.id);

      expect(released.id).toBe(created.id);
      expect(released.status).toBe('PENDING_REVIEW');
      expect(released.operation).toBe('submitAutoRelease');
      expect(released.escrowId).toBe('escrow-1');

      const row = await prisma.failedTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.status).toBe('PENDING_REVIEW');

      const reclaimed = await repo.claimForReplay(created.id);
      expect(reclaimed?.status).toBe('REPLAYING');
    });

    it('rejects an id that does not exist', async () => {
      await expect(
        repo.releaseClaim('00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  describe('StellarWebhookRepository.pruneOlderThan', () => {
    let repo: StellarWebhookRepository;

    beforeAll(() => {
      repo = new StellarWebhookRepository(prisma);
    });

    it('deletes only rows processed strictly before the cutoff', async () => {
      const cutoff = new Date('2026-01-10T00:00:00Z');
      await prisma.processedWebhookEvent.createMany({
        data: [
          {
            operationId: 'op-old-1',
            processedAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            operationId: 'op-old-2',
            processedAt: new Date('2026-01-09T23:59:59Z'),
          },
          { operationId: 'op-at-cutoff', processedAt: cutoff },
          {
            operationId: 'op-new',
            processedAt: new Date('2026-01-11T00:00:00Z'),
          },
        ],
      });

      const result = await repo.pruneOlderThan(cutoff);

      expect(result.count).toBe(2);
      const remaining = await prisma.processedWebhookEvent.findMany({
        orderBy: { operationId: 'asc' },
      });
      expect(remaining.map((r) => r.operationId)).toEqual([
        'op-at-cutoff',
        'op-new',
      ]);
      expect(await repo.isProcessed('op-old-1')).toBe(false);
      expect(await repo.isProcessed('op-new')).toBe(true);
    });

    it('returns a zero count when nothing is old enough', async () => {
      await repo.markProcessed('op-fresh');

      const result = await repo.pruneOlderThan(new Date(Date.now() - 60_000));

      expect(result.count).toBe(0);
      expect(await repo.isProcessed('op-fresh')).toBe(true);
    });
  });
});
