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
import { StellarWebhookDto } from './dto/stellar-webhook.dto';
import { StellarWebhookService } from './stellar-webhook.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal EscrowRecord-like object for test fixtures. */
function makeEscrow(
  overrides: Partial<{
    id: string;
    state: string;
    amount: number;
    currency: string;
    vendorAddress: string;
    buyerAddress: string;
  }> = {},
) {
  return {
    id: 'escrow-1',
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
    notificationsService = module.get(NotificationsService) as any;

    // Silence logger output during tests but capture calls for assertions.

    loggerWarnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    loggerLogSpy = jest
      .spyOn((service as any).logger, 'log')
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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    } as any);

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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);

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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);

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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);

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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    } as any);

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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);
    escrowRepository.updateState.mockResolvedValue({
      ...escrow,
      state: 'FUNDED',
    } as any);

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
    escrowRepository.findByVendor.mockResolvedValue([escrow] as any);

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
