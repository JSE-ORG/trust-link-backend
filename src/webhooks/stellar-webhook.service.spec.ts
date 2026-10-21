/**
 * Unit tests for StellarWebhookService – issue #396
 *
 * Covers all acceptance criteria:
 *   AC1. A CREATED escrow receiving a correct, full payment transitions to FUNDED.
 *   AC2. An underpayment does not fund the escrow and is logged.
 *   AC3. An overpayment is rejected (does not fund the escrow) and is logged.
 *   AC4. A wrong asset_code does not fund the escrow and is logged.
 *   AC5. An already-FUNDED escrow is a no-op, not a rewrite.
 *   AC6. A payment matching no escrow is logged and returns cleanly without throwing.
 *   AC7. The lookup uses vendorAddress (dto.to = destination = vendor address).
 *
 * The service is tested without a real database.  We supply hand-rolled mocks
 * for ConfigService, EscrowRepository, and (where needed) PrismaService.
 */

import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../config/config.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowRecord } from '../prisma/prisma.service';
import { StellarWebhookDto } from './dto/stellar-webhook.dto';
import { StellarWebhookRepository } from './stellar-webhook.repository';
import { StellarWebhookService } from './stellar-webhook.service';
import { TracingService } from '../tracing/tracing.service';
import { createTracingMock } from '../../test/unit/tracing-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an EscrowRecord for test fixtures. */
function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'escrow-1',
    contractEscrowId: null,
    state: 'CREATED',
    // Plain number – Number(500) === 500 so the service's Number(escrow.amount) works correctly.
    amount: 500,
    currency: 'USDC',
    vendorAddress: 'GVENDOR1111111111111111111111111111111111111111111111111',
    buyerAddress: 'GBUYER111111111111111111111111111111111111111111111111111',
    itemName: 'Widget',
    itemRef: 'REF-001',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    buyerContactEmail: null,
    buyerContactPhone: null,
    cancelledAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Build a valid payment DTO. */
function makePaymentDto(
  overrides: Partial<StellarWebhookDto> = {},
): StellarWebhookDto {
  return {
    type: 'payment',
    id: 'op-001',
    transaction_hash: 'txhash001',
    to: 'GVENDOR1111111111111111111111111111111111111111111111111',
    from: 'GBUYER111111111111111111111111111111111111111111111111111',
    amount: '500.0000000',
    asset_code: 'USDC',
    ...overrides,
  };
}

/**
 * In-memory stand-in for the persisted `ProcessedWebhookEvent` cursor. The
 * service no longer keeps its own dedupe state, so tests must supply a
 * repository that actually remembers what was marked.
 */
function makeWebhookRepositoryMock(): jest.Mocked<StellarWebhookRepository> {
  const processed = new Set<string>();
  return {
    isProcessed: jest.fn((id: string) => Promise.resolve(processed.has(id))),
    markProcessed: jest.fn((id: string) => {
      processed.add(id);
      return Promise.resolve();
    }),
    unmarkProcessed: jest.fn((id: string) => {
      processed.delete(id);
      return Promise.resolve();
    }),
  } as unknown as jest.Mocked<StellarWebhookRepository>;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('StellarWebhookService – handlePayment (issue #396)', () => {
  let service: StellarWebhookService;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let notificationsService: jest.Mocked<NotificationsService>;

  /** Spy on the private logger so we can assert on warn/log calls. */
  let loggerWarnSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mockEscrowRepository: jest.Mocked<
      Pick<EscrowRepository, 'findByVendor' | 'findByBuyer' | 'updateState'>
    > = {
      findByVendor: jest.fn(),
      findByBuyer: jest.fn(),
      updateState: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue(undefined), // no STELLAR_WEBHOOK_SECRET → skip sig check
    };

    const mockNotificationsService = {
      notifyFunded: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TracingService, useValue: createTracingMock().service },
        StellarWebhookService,
        { provide: EscrowRepository, useValue: mockEscrowRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        {
          provide: StellarWebhookRepository,
          useValue: makeWebhookRepositoryMock(),
        },
      ],
    }).compile();

    service = module.get(StellarWebhookService);
    escrowRepository = module.get(EscrowRepository);
    notificationsService = module.get(NotificationsService);

    // Silence logger output during tests but capture calls for assertions.

    loggerWarnSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    loggerLogSpy = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Helper: invoke handlePayment via the public processOperationDto path ──
  async function runPayment(dto: StellarWebhookDto) {
    return service.processOperationDto(dto);
  }

  // =========================================================================
  // AC1 – Correct, full payment transitions a CREATED escrow to FUNDED
  // =========================================================================
  it('AC1: transitions a CREATED escrow to FUNDED on exact payment', async () => {
    const escrow = makeEscrow({
      state: 'CREATED',
      amount: 500,
      currency: 'USDC',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    });

    const dto = makePaymentDto({ amount: '500.0000000', asset_code: 'USDC' });
    await runPayment(dto);

    // AC7: lookup must use vendorAddress (dto.to), NOT buyerAddress
    expect(escrowRepository.findByVendor).toHaveBeenCalledWith(dto.to);
    expect(escrowRepository.findByBuyer).not.toHaveBeenCalled();

    // State should be advanced to FUNDED
    expect(escrowRepository.updateState).toHaveBeenCalledWith(
      escrow.id,
      'FUNDED',
    );

    // Confirmation log emitted
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.deposit_confirmed'),
    );

    expect(notificationsService.notifyFunded).toHaveBeenCalledWith({
      ...escrow,
      state: 'FUNDED',
    });
  });

  // =========================================================================
  // AC2 – Underpayment does not fund the escrow and is logged
  // =========================================================================
  it('AC2: underpayment does not fund the escrow and emits a warning', async () => {
    const escrow = makeEscrow({
      state: 'CREATED',
      amount: 500,
      currency: 'USDC',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);

    const dto = makePaymentDto({ amount: '499.9999999', asset_code: 'USDC' });
    await runPayment(dto);

    expect(escrowRepository.updateState).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.amount_mismatch'),
    );
  });

  // =========================================================================
  // AC3 – Overpayment is rejected (not funded) and is logged
  // =========================================================================
  it('AC3: overpayment is rejected – escrow not funded, warning logged', async () => {
    const escrow = makeEscrow({
      state: 'CREATED',
      amount: 500,
      currency: 'USDC',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);

    const dto = makePaymentDto({ amount: '500.0000001', asset_code: 'USDC' });
    await runPayment(dto);

    expect(escrowRepository.updateState).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.amount_mismatch'),
    );
  });

  // =========================================================================
  // AC4 – Wrong asset_code does not fund the escrow and is logged
  // =========================================================================
  it('AC4: wrong asset_code does not fund the escrow and emits a warning', async () => {
    const escrow = makeEscrow({
      state: 'CREATED',
      amount: 500,
      currency: 'USDC',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);

    const dto = makePaymentDto({ amount: '500.0000000', asset_code: 'XLM' });
    await runPayment(dto);

    expect(escrowRepository.updateState).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.asset_mismatch'),
    );
  });

  it('AC4b: asset comparison is case-insensitive (usdc vs USDC)', async () => {
    const escrow = makeEscrow({
      state: 'CREATED',
      amount: 500,
      currency: 'USDC',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    });

    const dto = makePaymentDto({ amount: '500.0000000', asset_code: 'usdc' });
    await runPayment(dto);

    expect(escrowRepository.updateState).toHaveBeenCalledWith(
      escrow.id,
      'FUNDED',
    );
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it('AC4c: missing asset_code is treated as XLM', async () => {
    const escrow = makeEscrow({
      state: 'CREATED',
      amount: 100,
      currency: 'XLM',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    });

    const dto = makePaymentDto({
      amount: '100.0000000',
      asset_code: undefined,
    });
    await runPayment(dto);

    expect(escrowRepository.updateState).toHaveBeenCalledWith(
      escrow.id,
      'FUNDED',
    );
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  // =========================================================================
  // AC5 – An already-FUNDED escrow is a no-op, not a rewrite
  // =========================================================================
  it('AC5: already-FUNDED escrow is skipped (no updateState call)', async () => {
    const escrow = makeEscrow({
      state: 'FUNDED',
      amount: 500,
      currency: 'USDC',
    });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);

    const dto = makePaymentDto({ amount: '500.0000000', asset_code: 'USDC' });
    await runPayment(dto);

    // FUNDED is not in the CREATED filter → treated as "no matching escrow"
    expect(escrowRepository.updateState).not.toHaveBeenCalled();
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.no_matching_escrow'),
    );
  });

  // =========================================================================
  // AC6 – Payment matching no escrow is logged and returns cleanly
  // =========================================================================
  it('AC6: no matching escrow → logs and returns cleanly without throwing', async () => {
    escrowRepository.findByVendor.mockResolvedValue([]);

    const dto = makePaymentDto();
    await expect(runPayment(dto)).resolves.not.toThrow();

    expect(escrowRepository.updateState).not.toHaveBeenCalled();
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.no_matching_escrow'),
    );
  });

  // =========================================================================
  // Additional edge-case: missing dto.to throws BadRequestException
  // =========================================================================
  // =========================================================================
  // Notification delivery must not hold up the webhook response
  // =========================================================================
  it('does not wait on notifyFunded delivery', async () => {
    const escrow = makeEscrow({ state: 'CREATED' });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    });
    notificationsService.notifyFunded.mockReturnValue(new Promise(() => {}));

    await expect(runPayment(makePaymentDto())).resolves.toEqual({
      processed: true,
    });

    expect(notificationsService.notifyFunded).toHaveBeenCalledTimes(1);
  });

  it('logs a failed notifyFunded without failing the webhook', async () => {
    const escrow = makeEscrow({ state: 'CREATED' });
    escrowRepository.findByVendor.mockResolvedValue([escrow]);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    });
    const error = new Error('provider down');
    notificationsService.notifyFunded.mockRejectedValue(error);
    const loggerErrorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(runPayment(makePaymentDto())).resolves.toEqual({
      processed: true,
    });
    await new Promise(process.nextTick);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      `Failed to send funded notification for escrow ${escrow.id}`,
      error,
    );
  });

  it('throws BadRequestException when dto.to is missing', async () => {
    const dto = makePaymentDto({ to: undefined });
    await expect(runPayment(dto)).rejects.toThrow(BadRequestException);
    expect(escrowRepository.findByVendor).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Non-payment event types are ignored (no escrow lookup)
  // =========================================================================
  it('ignores non-payment event types without touching the repository', async () => {
    const dto: StellarWebhookDto = {
      type: 'account_created',
      id: 'op-999',
      transaction_hash: 'txhash999',
    };

    await expect(runPayment(dto)).resolves.not.toThrow();
    expect(escrowRepository.findByVendor).not.toHaveBeenCalled();
    expect(escrowRepository.updateState).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issues #734 / #922 — persisted duplicate-delivery (replay) guard
// ---------------------------------------------------------------------------

import * as crypto from 'crypto';

const WEBHOOK_SECRET = 'test-webhook-secret';

/** Compute a valid HMAC-SHA256 hex signature for rawBody using WEBHOOK_SECRET. */
function sign(rawBody: Buffer): string {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
}

describe('StellarWebhookService — persisted replay guard (issues #734, #922)', () => {
  let escrowRepository: jest.Mocked<
    Pick<EscrowRepository, 'findByVendor' | 'updateState'>
  >;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'notifyFunded'>
  >;
  let webhookRepository: jest.Mocked<StellarWebhookRepository>;

  /** Build a service instance wired to the persisted webhook cursor. */
  function makeService(): StellarWebhookService {
    return new StellarWebhookService(
      {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'STELLAR_WEBHOOK_SECRET') return WEBHOOK_SECRET;
          return undefined;
        }),
      } as unknown as ConfigService,
      escrowRepository as unknown as EscrowRepository,
      notificationsService as unknown as NotificationsService,
      webhookRepository,
    );
  }

  beforeEach(() => {
    escrowRepository = {
      findByVendor: jest.fn().mockResolvedValue([]),
      updateState: jest.fn(),
    };
    notificationsService = {
      notifyFunded: jest.fn().mockResolvedValue(undefined),
    };
    webhookRepository = makeWebhookRepositoryMock();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Helper ────────────────────────────────────────────────────────────────

  async function callHandleEvent(
    service: StellarWebhookService,
    dto: StellarWebhookDto,
  ) {
    const rawBody = Buffer.from(JSON.stringify(dto));
    const signature = sign(rawBody);
    return service.handleEvent(rawBody, signature, dto);
  }

  // ── Issue #922: replay must honour the persisted dedupe ───────────────────

  describe('persisted dedupe across the webhook and replay paths', () => {
    it('skips an operation already processed by the webhook when replaying', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-replay-dedupe' });

      const delivered = await callHandleEvent(service, dto);
      expect(delivered).toEqual({ received: true });
      expect(webhookRepository.markProcessed).toHaveBeenCalledWith(
        'op-replay-dedupe',
      );

      // Replay of the same operation must observe the persisted mark and skip.
      const replayed = await service.processOperationDto(dto);
      expect(replayed).toEqual({ processed: false, skipped: true });
      expect(escrowRepository.findByVendor).toHaveBeenCalledTimes(1);
    });

    it('marks and rolls back the persisted cursor on processing failure', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-persisted-rollback' });
      escrowRepository.findByVendor.mockRejectedValueOnce(
        new Error('DB unavailable'),
      );

      // The first delivery fails — the persisted mark must be rolled back.
      await callHandleEvent(service, dto).catch(() => undefined);

      expect(webhookRepository.markProcessed).toHaveBeenCalledWith(
        'op-persisted-rollback',
      );
      expect(webhookRepository.unmarkProcessed).toHaveBeenCalledWith(
        'op-persisted-rollback',
      );

      // Second delivery with the same id must not be treated as a duplicate.
      escrowRepository.findByVendor.mockResolvedValueOnce([]);
      const retry = await callHandleEvent(service, dto);

      expect(retry.skipped).toBeUndefined();
      expect(retry).toEqual({ received: true });
    });
  });

  // ── Duplicate guard via the persisted cursor ─────────────────────────────

  describe('duplicate-delivery (replay) guard', () => {
    it('returns skipped:true on the second delivery of the same operation id', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-replay-001' });

      const first = await callHandleEvent(service, dto);
      const second = await callHandleEvent(service, dto);

      expect(first).toEqual({ received: true });
      expect(second).toEqual({
        received: true,
        skipped: true,
        reason: 'duplicate',
      });
    });

    it('processes the event only once when delivered twice', async () => {
      const service = makeService();
      const escrow = makeEscrow({
        state: 'CREATED',
        amount: 500,
        currency: 'USDC',
      });
      escrowRepository.findByVendor.mockResolvedValue([escrow]);
      escrowRepository.updateState.mockResolvedValue({
        ...escrow,
        state: 'FUNDED',
      });
      notificationsService.notifyFunded.mockResolvedValue(undefined);

      const dto = makePaymentDto({ id: 'op-replay-002' });

      await callHandleEvent(service, dto);
      await callHandleEvent(service, dto);

      // updateState must have been called exactly once despite two deliveries
      expect(escrowRepository.updateState).toHaveBeenCalledTimes(1);
    });

    it('a third distinct id is not treated as a duplicate', async () => {
      const service = makeService();

      await callHandleEvent(service, makePaymentDto({ id: 'op-A' }));
      await callHandleEvent(service, makePaymentDto({ id: 'op-A' })); // duplicate
      const result = await callHandleEvent(
        service,
        makePaymentDto({ id: 'op-B' }),
      );

      expect(result).toEqual({ received: true });
      // findByVendor called for op-A (first) and op-B — not for the duplicate
      expect(escrowRepository.findByVendor).toHaveBeenCalledTimes(2);
    });
  });

  // ── Ported from test/unit/stellar-webhook.service.spec.ts (issue #759) ───
  // The rest of this file drives handleEvent with a secret always configured
  // and a valid signature already computed by callHandleEvent/sign — none of
  // it exercises verifySignature's own rejection paths.
  describe('signature verification', () => {
    /** Build a service instance with no STELLAR_WEBHOOK_SECRET configured. */
    function makeServiceNoSecret(): StellarWebhookService {
      return new StellarWebhookService(
        {
          get: jest.fn().mockReturnValue(undefined),
        } as unknown as ConfigService,
        escrowRepository as unknown as EscrowRepository,
        notificationsService as unknown as NotificationsService,
        webhookRepository,
      );
    }

    it('rejects when STELLAR_WEBHOOK_SECRET is not configured', async () => {
      const service = makeServiceNoSecret();
      const dto = makePaymentDto();
      const rawBody = Buffer.from(JSON.stringify(dto));

      await expect(
        service.handleEvent(rawBody, undefined, dto),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('accepts a valid HMAC-SHA256 signature', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-sig-valid' });
      const rawBody = Buffer.from(JSON.stringify(dto));
      const signature = sign(rawBody);

      await expect(
        service.handleEvent(rawBody, signature, dto),
      ).resolves.toEqual({ received: true });
    });

    it('rejects a tampered signature', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-sig-tampered' });
      const rawBody = Buffer.from(JSON.stringify(dto));

      await expect(
        service.handleEvent(rawBody, 'deadbeef', dto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when signature header is missing and secret is configured', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-sig-missing' });
      const rawBody = Buffer.from(JSON.stringify(dto));

      await expect(
        service.handleEvent(rawBody, undefined, dto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('logs webhook processing failures with event context before rethrowing', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-sig-log-fail', to: undefined });
      const rawBody = Buffer.from(JSON.stringify(dto));
      const signature = sign(rawBody);
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await expect(
        service.handleEvent(rawBody, signature, dto),
      ).rejects.toThrow(BadRequestException);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('stellar.webhook.processing_failed'),
        expect.any(String),
      );

      loggerErrorSpy.mockRestore();
    });
  });
});
