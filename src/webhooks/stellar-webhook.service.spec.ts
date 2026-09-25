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

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../config/config.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowRecord } from '../prisma/prisma.service';
import { StellarWebhookDto } from './dto/stellar-webhook.dto';
import { StellarWebhookService } from './stellar-webhook.service';

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
        StellarWebhookService,
        { provide: EscrowRepository, useValue: mockEscrowRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NotificationsService, useValue: mockNotificationsService },
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
// Issue #734 — no-Prisma path and duplicate-delivery (replay) guard
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

describe('StellarWebhookService — no-Prisma path and replay guard (issue #734)', () => {
  let escrowRepository: jest.Mocked<
    Pick<EscrowRepository, 'findByVendor' | 'updateState'>
  >;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyFunded'>>;

  /** Build a service instance with no PrismaService injected (the @Optional() path). */
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
      // no PrismaService argument → this.prisma is undefined
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

  // ── Branch: this.prisma absent — first delivery uses processedIds.add ────

  describe('no-Prisma path (this.prisma guards)', () => {
    it('processes the first delivery using the in-memory processedIds set', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-no-prisma-1' });

      const result = await callHandleEvent(service, dto);

      expect(result).toEqual({ received: true });
      // No Prisma means no DB call — repository is still called for the event itself
      expect(escrowRepository.findByVendor).toHaveBeenCalledWith(dto.to);
    });

    it('uses processedIds.has for duplicate check when Prisma is absent', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-no-prisma-2' });

      // First delivery — processes normally
      await callHandleEvent(service, dto);
      // Second delivery with the same id — must be a no-op
      const second = await callHandleEvent(service, dto);

      expect(second).toEqual({ received: true, skipped: true, reason: 'duplicate' });
      // findByVendor called exactly once (from the first delivery only)
      expect(escrowRepository.findByVendor).toHaveBeenCalledTimes(1);
    });

    it('rolls back processedIds on processEvent failure (no Prisma)', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-no-prisma-rollback' });
      escrowRepository.findByVendor.mockRejectedValueOnce(
        new Error('DB unavailable'),
      );

      // First call fails — the id should be removed from processedIds
      await callHandleEvent(service, dto).catch(() => undefined);

      // Second call with the same id must not be treated as a duplicate
      escrowRepository.findByVendor.mockResolvedValueOnce([]);
      const retry = await callHandleEvent(service, dto);

      expect(retry.skipped).toBeUndefined();
      expect(retry).toEqual({ received: true });
    });
  });

  // ── Branch: this.processedIds.has(dto.id) duplicate guard ────────────────

  describe('duplicate-delivery (replay) guard', () => {
    it('returns skipped:true on the second delivery of the same operation id', async () => {
      const service = makeService();
      const dto = makePaymentDto({ id: 'op-replay-001' });

      const first = await callHandleEvent(service, dto);
      const second = await callHandleEvent(service, dto);

      expect(first).toEqual({ received: true });
      expect(second).toEqual({ received: true, skipped: true, reason: 'duplicate' });
    });

    it('processes the event only once when delivered twice', async () => {
      const service = makeService();
      const escrow = makeEscrow({ state: 'CREATED', amount: 500, currency: 'USDC' });
      escrowRepository.findByVendor.mockResolvedValue([escrow]);
      escrowRepository.updateState.mockResolvedValue({ ...escrow, state: 'FUNDED' });
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
      const result = await callHandleEvent(service, makePaymentDto({ id: 'op-B' }));

      expect(result).toEqual({ received: true });
      // findByVendor called for op-A (first) and op-B — not for the duplicate
      expect(escrowRepository.findByVendor).toHaveBeenCalledTimes(2);
    });
  });
});
