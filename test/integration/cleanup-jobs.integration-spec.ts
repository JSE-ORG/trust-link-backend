import { INestApplication } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshTokenCleanupService } from '../../src/auth/sep10/refresh-token-cleanup.service';
import { RefreshTokenRepository } from '../../src/auth/sep10/refresh-token.repository';
import {
  Config,
  ConfigService as AppConfigService,
} from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StellarWebhookRepository } from '../../src/webhooks/stellar-webhook.repository';
import { WebhookCleanupService } from '../../src/webhooks/webhook-cleanup.service';

describe('Cleanup jobs integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let refreshTokenCleanupService: RefreshTokenCleanupService;
  let webhookCleanupService: WebhookCleanupService;
  const now = new Date('2026-01-15T12:00:00.000Z');
  let originalRetentionDays: string | undefined;

  beforeAll(async () => {
    originalRetentionDays = process.env.WEBHOOK_EVENT_RETENTION_DAYS;
    process.env.WEBHOOK_EVENT_RETENTION_DAYS = '7';

    prisma = new PrismaService();
    const nestConfigService = new NestConfigService<Config, true>({
      WEBHOOK_EVENT_RETENTION_DAYS: Number(
        process.env.WEBHOOK_EVENT_RETENTION_DAYS,
      ),
    } as Config);
    const configService = new AppConfigService(nestConfigService);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenCleanupService,
        RefreshTokenRepository,
        WebhookCleanupService,
        StellarWebhookRepository,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AppConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    refreshTokenCleanupService = moduleFixture.get(RefreshTokenCleanupService);
    webhookCleanupService = moduleFixture.get(WebhookCleanupService);
  });

  afterAll(async () => {
    await prisma.reset();
    await app.close();
    if (originalRetentionDays === undefined) {
      delete process.env.WEBHOOK_EVENT_RETENTION_DAYS;
    } else {
      process.env.WEBHOOK_EVENT_RETENTION_DAYS = originalRetentionDays;
    }
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  it('deletes only refresh tokens older than the cleanup cutoff', async () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const expiredTokenHash = 'cleanup-expired-token';
    const expiredRevokedTokenHash = 'cleanup-expired-revoked-token';
    const cutoffTokenHash = 'cleanup-cutoff-token';
    const newerTokenHash = 'cleanup-newer-token';
    const revokedUnexpiredTokenHash = 'cleanup-revoked-unexpired-token';

    await prisma.refreshToken.createMany({
      data: [
        {
          userId: 'cleanup-user',
          tokenHash: expiredTokenHash,
          expiresAt: new Date(cutoff.getTime() - 1),
        },
        {
          userId: 'cleanup-user',
          tokenHash: expiredRevokedTokenHash,
          revoked: true,
          expiresAt: new Date(cutoff.getTime() - 1),
        },
        {
          userId: 'cleanup-user',
          tokenHash: cutoffTokenHash,
          expiresAt: cutoff,
        },
        {
          userId: 'cleanup-user',
          tokenHash: newerTokenHash,
          expiresAt: new Date(cutoff.getTime() + 1),
        },
        {
          userId: 'cleanup-user',
          tokenHash: revokedUnexpiredTokenHash,
          revoked: true,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      ],
    });

    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    try {
      await refreshTokenCleanupService.cleanupExpiredRefreshTokens();
    } finally {
      dateNowSpy.mockRestore();
    }

    const remaining = await prisma.refreshToken.findMany({
      select: { tokenHash: true },
      orderBy: { tokenHash: 'asc' },
    });
    expect(remaining.map(({ tokenHash }) => tokenHash)).toEqual([
      cutoffTokenHash,
      newerTokenHash,
      revokedUnexpiredTokenHash,
    ]);
  });

  it('honors WEBHOOK_EVENT_RETENTION_DAYS and preserves rows at the cutoff', async () => {
    const retentionDays = Number(process.env.WEBHOOK_EVENT_RETENTION_DAYS);
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
    );
    const oldOperationId = 'cleanup-webhook-old';
    const cutoffOperationId = 'cleanup-webhook-cutoff';
    const newOperationId = 'cleanup-webhook-new';

    await prisma.processedWebhookEvent.createMany({
      data: [
        {
          operationId: oldOperationId,
          processedAt: new Date(cutoff.getTime() - 1),
        },
        { operationId: cutoffOperationId, processedAt: cutoff },
        {
          operationId: newOperationId,
          processedAt: new Date(cutoff.getTime() + 1),
        },
      ],
    });

    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    try {
      await webhookCleanupService.pruneProcessedWebhookEvents();
    } finally {
      dateNowSpy.mockRestore();
    }

    const remaining = await prisma.processedWebhookEvent.findMany({
      select: { operationId: true },
      orderBy: { operationId: 'asc' },
    });
    expect(remaining.map(({ operationId }) => operationId)).toEqual([
      cutoffOperationId,
      newOperationId,
    ]);
  });
});
