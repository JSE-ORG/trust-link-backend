/**
 * Integration tests for WebhookCleanupService (issue #1121).
 *
 * Exercises the prune job against a real PostgreSQL database to verify that:
 * - ProcessedWebhookEvent rows older than the retention window are deleted.
 * - Rows within the retention window are kept.
 * - The custom WEBHOOK_EVENT_RETENTION_DAYS env var is honoured.
 * - The job is idempotent and safe on an empty table.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookCleanupService } from '../../src/webhooks/webhook-cleanup.service';
import { StellarWebhookRepository } from '../../src/webhooks/stellar-webhook.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '../../src/config/config.service';

const DEFAULT_RETENTION_DAYS = 30;

function makeConfig(retentionDays = DEFAULT_RETENTION_DAYS) {
  return {
    get: jest.fn((key: string) => {
      if (key === 'WEBHOOK_EVENT_RETENTION_DAYS') return retentionDays;
      return undefined;
    }),
  } as unknown as ConfigService;
}

describe('WebhookCleanupService integration (issue #1121)', () => {
  let app: INestApplication;
  let cleanupService: WebhookCleanupService;
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookCleanupService,
        StellarWebhookRepository,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    cleanupService = moduleFixture.get(WebhookCleanupService);
  });

  afterAll(async () => {
    await prisma.reset();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  function createEvent(operationId: string, processedAt: Date) {
    return prisma.processedWebhookEvent.create({
      data: { operationId, processedAt },
    });
  }

  it('deletes rows older than the default 30-day retention window', async () => {
    const retentionMs = DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - retentionMs - 1000);
    await createEvent('op-old-1', old);
    await createEvent('op-old-2', old);

    await cleanupService.pruneProcessedWebhookEvents();

    expect(await prisma.processedWebhookEvent.count()).toBe(0);
  });

  it('keeps rows within the 30-day retention window', async () => {
    const retentionMs = DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const recent = new Date(Date.now() - retentionMs + 60_000);
    await createEvent('op-recent', recent);

    await cleanupService.pruneProcessedWebhookEvents();

    const remaining = await prisma.processedWebhookEvent.findUnique({
      where: { operationId: 'op-recent' },
    });
    expect(remaining).not.toBeNull();
  });

  it('runs without error on an empty table', async () => {
    await expect(cleanupService.pruneProcessedWebhookEvents()).resolves.not.toThrow();
  });

  it('only removes old rows, leaving recent rows intact', async () => {
    const retentionMs = DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - retentionMs - 1000);
    const recent = new Date(Date.now() - 1000);

    await createEvent('op-delete', old);
    await createEvent('op-keep', recent);

    await cleanupService.pruneProcessedWebhookEvents();

    expect(
      await prisma.processedWebhookEvent.findUnique({ where: { operationId: 'op-delete' } }),
    ).toBeNull();
    expect(
      await prisma.processedWebhookEvent.findUnique({ where: { operationId: 'op-keep' } }),
    ).not.toBeNull();
  });

  it('honours a custom WEBHOOK_EVENT_RETENTION_DAYS value', async () => {
    // Build a module with a 7-day retention.
    const shortRetentionDays = 7;
    const shortRetentionMs = shortRetentionDays * 24 * 60 * 60 * 1000;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookCleanupService,
        StellarWebhookRepository,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: makeConfig(shortRetentionDays) },
      ],
    }).compile();

    const shortApp = moduleFixture.createNestApplication();
    await shortApp.init();
    const shortCleanup = moduleFixture.get(WebhookCleanupService);

    // Row processed 8 days ago — older than 7-day window → deleted.
    const old8d = new Date(Date.now() - shortRetentionMs - 24 * 60 * 60 * 1000);
    // Row processed 6 days ago — within 7-day window → kept.
    const recent6d = new Date(Date.now() - shortRetentionMs + 24 * 60 * 60 * 1000);

    await createEvent('op-8d-old', old8d);
    await createEvent('op-6d-recent', recent6d);

    await shortCleanup.pruneProcessedWebhookEvents();

    expect(
      await prisma.processedWebhookEvent.findUnique({ where: { operationId: 'op-8d-old' } }),
    ).toBeNull();
    expect(
      await prisma.processedWebhookEvent.findUnique({ where: { operationId: 'op-6d-recent' } }),
    ).not.toBeNull();

    await shortApp.close();
  });
});
