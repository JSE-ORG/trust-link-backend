import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { ConfigService } from '../../src/config/config.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StellarWebhookDto } from '../../src/webhooks/dto/stellar-webhook.dto';
import { StellarWebhookService } from '../../src/webhooks/stellar-webhook.service';

describe('StellarWebhookService (issue #76)', () => {
  let service: StellarWebhookService;
  let configService: jest.Mocked<ConfigService>;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let notificationsService: jest.Mocked<NotificationsService>;

  const SECRET = 'test-webhook-secret';

  const makeDto = (
    overrides: Partial<StellarWebhookDto> = {},
  ): StellarWebhookDto => ({
    type: 'payment',
    id: 'op-001',
    transaction_hash: 'tx-abc123',
    // dto.to is the vendor's Stellar address (payment destination).
    to: 'GVENDOR001',
    from: 'GBUYER001',
    amount: '100.00',
    asset_code: 'USDC',
    ...overrides,
  });

  const sign = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  /** Minimal CREATED escrow fixture matching makeDto defaults. */
  const makeCreatedEscrow = (overrides: Record<string, unknown> = {}) => ({
    id: 'escrow-1',
    contractEscrowId: null,
    state: 'CREATED' as const,
    buyerAddress: 'GBUYER001',
    vendorAddress: 'GVENDOR001',
    itemName: 'Widget',
    itemRef: 'w-1',
    amount: 100,
    currency: 'USDC',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
      getAllowedOrigins: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ConfigService>;

    escrowRepository = {
      // Issue #396: handlePayment now uses findByVendor (dto.to = destination = vendor address).
      findByVendor: jest.fn(),
      updateState: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    notificationsService = {
      notifyFunded: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        StellarWebhookService,
        { provide: ConfigService, useValue: configService },
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = moduleRef.get(StellarWebhookService);
  });

  // ── Signature verification ─────────────────────────────────────────────────

  it('rejects when STELLAR_WEBHOOK_SECRET is not configured', async () => {
    configService.get.mockReturnValue(undefined);
    const dto = makeDto();
    const raw = Buffer.from(JSON.stringify(dto));

    await expect(service.handleEvent(raw, undefined, dto)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('accepts a valid HMAC-SHA256 signature', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto();
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);

    escrowRepository.findByVendor.mockResolvedValue([]);

    await expect(service.handleEvent(raw, sig, dto)).resolves.toEqual({
      received: true,
    });
  });

  it('rejects a tampered signature', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto();
    const raw = Buffer.from(JSON.stringify(dto));

    await expect(service.handleEvent(raw, 'deadbeef', dto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when signature header is missing and secret is configured', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto();
    const raw = Buffer.from(JSON.stringify(dto));

    await expect(service.handleEvent(raw, undefined, dto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('deduplicates events with the same operation id', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto({ id: 'op-dup' });
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);

    escrowRepository.findByVendor.mockResolvedValue([]);

    // First call – processed
    await service.handleEvent(raw, sig, dto);
    // Second call – duplicate
    const result = await service.handleEvent(raw, sig, dto);

    expect(result).toEqual({
      received: true,
      skipped: true,
      reason: 'duplicate',
    });
    // findByVendor should only have been called once
    expect(escrowRepository.findByVendor).toHaveBeenCalledTimes(1);
  });

  // ── Payment handling ───────────────────────────────────────────────────────

  it('updates escrow state on a confirmed deposit', async () => {
    configService.get.mockReturnValue(SECRET);
    // dto.to = vendor address; amount and asset_code match the escrow fixture.
    const dto = makeDto({
      to: 'GVENDOR001',
      amount: '100.00',
      asset_code: 'USDC',
    });
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);

    const createdEscrow = makeCreatedEscrow();

    escrowRepository.findByVendor.mockResolvedValue([createdEscrow]);
    escrowRepository.updateState.mockResolvedValue({
      ...createdEscrow,
      state: 'FUNDED',
    } as any);

    const result = await service.handleEvent(raw, sig, dto);

    expect(result).toEqual({ received: true });
    expect(escrowRepository.findByVendor).toHaveBeenCalledWith('GVENDOR001');
    expect(escrowRepository.updateState).toHaveBeenCalledWith(
      'escrow-1',
      'FUNDED',
    );
    expect(notificationsService.notifyFunded).toHaveBeenCalledWith({
      ...createdEscrow,
      state: 'FUNDED',
    });
  });

  it('does nothing when no matching escrow is found', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto({ to: 'GUNKNOWN' });
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);

    escrowRepository.findByVendor.mockResolvedValue([]);

    const result = await service.handleEvent(raw, sig, dto);

    expect(result).toEqual({ received: true });
    expect(escrowRepository.updateState).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when payment event has no destination', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto({ to: undefined });
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);

    await expect(service.handleEvent(raw, sig, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('logs webhook processing failures with event context before rethrowing', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto({ id: 'op-fail', to: undefined });
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();

    await expect(service.handleEvent(raw, sig, dto)).rejects.toThrow(
      BadRequestException,
    );

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('stellar.webhook.processing_failed'),
      expect.any(String),
    );
  });

  it('silently ignores unhandled event types', async () => {
    configService.get.mockReturnValue(SECRET);
    const dto = makeDto({ type: 'account_created', to: undefined });
    const raw = Buffer.from(JSON.stringify(dto));
    const sig = sign(raw, SECRET);

    const result = await service.handleEvent(raw, sig, dto);

    expect(result).toEqual({ received: true });
    expect(escrowRepository.findByVendor).not.toHaveBeenCalled();
  });
});
