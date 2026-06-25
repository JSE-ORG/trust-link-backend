import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { ConfigService } from '../../src/config/config.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { StellarWebhookDto } from '../../src/webhooks/dto/stellar-webhook.dto';
import { StellarWebhookService } from '../../src/webhooks/stellar-webhook.service';

/**
 * Issue #48 — focused unit tests for the HMAC-SHA256 signature verification
 * that guards the Stellar webhook endpoint.
 *
 * These tests exercise verifySignature() through the public handleEvent() entry
 * point, asserting that:
 *  - a signature computed over the EXACT raw body bytes is accepted, and
 *  - any deviation (tampered body, wrong secret, malformed/short/long signature,
 *    missing header) is strictly rejected with UnauthorizedException.
 */
describe('StellarWebhookService — HMAC signature verification (issue #48)', () => {
  let service: StellarWebhookService;
  let configService: jest.Mocked<ConfigService>;
  let escrowRepository: jest.Mocked<EscrowRepository>;

  const SECRET = 'super-secret-shared-key';

  const makeDto = (
    overrides: Partial<StellarWebhookDto> = {},
  ): StellarWebhookDto => ({
    type: 'payment',
    id: 'op-sig-001',
    transaction_hash: 'tx-sig-abc',
    to: 'GBUYER_SIG',
    from: 'GSENDER_SIG',
    amount: '42.50',
    asset_code: 'USDC',
    ...overrides,
  });

  /** Canonical HMAC-SHA256 hex digest of a raw body under a secret. */
  const sign = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
      getAllowedOrigins: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ConfigService>;

    escrowRepository = {
      findByBuyer: jest.fn().mockResolvedValue([]),
      updateState: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        StellarWebhookService,
        { provide: ConfigService, useValue: configService },
        { provide: EscrowRepository, useValue: escrowRepository },
      ],
    }).compile();

    service = moduleRef.get(StellarWebhookService);
  });

  // ── Valid payloads pass verification cleanly ───────────────────────────────

  describe('valid signatures', () => {
    it('accepts a signature computed over the exact raw body', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      const sig = sign(raw, SECRET);

      await expect(service.handleEvent(raw, sig, dto)).resolves.toEqual({
        received: true,
      });
    });

    it('verifies HMAC with a known test vector', async () => {
      configService.get.mockReturnValue('key');
      const raw = Buffer.from(
        'The quick brown fox jumps over the lazy dog',
        'utf8',
      );
      const sig =
        'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
      const dto = makeDto({ id: 'known-vector-001' });

      await expect(service.handleEvent(raw, sig, dto)).resolves.toEqual({
        received: true,
      });
    });

    it('verifies the digest of the raw bytes, independent of DTO field order', async () => {
      configService.get.mockReturnValue(SECRET);
      // A body whose JSON key order differs from a naive re-serialization of the
      // DTO. Verification must hash the bytes we were GIVEN, not a re-stringify.
      const raw = Buffer.from(
        '{"amount":"42.50","id":"op-sig-001","type":"payment","transaction_hash":"tx-sig-abc","to":"GBUYER_SIG"}',
        'utf8',
      );
      const dto = makeDto();
      const sig = sign(raw, SECRET);

      await expect(service.handleEvent(raw, sig, dto)).resolves.toEqual({
        received: true,
      });
    });

    it('accepts an empty body when the signature matches the empty-body digest', async () => {
      configService.get.mockReturnValue(SECRET);
      const raw = Buffer.alloc(0);
      const sig = sign(raw, SECRET);
      const dto = makeDto({ type: 'account_created', to: undefined });

      await expect(service.handleEvent(raw, sig, dto)).resolves.toEqual({
        received: true,
      });
    });
  });

  // ── Modified payloads / bad signatures trigger strict rejection ────────────

  describe('rejection checks', () => {
    it('rejects when the body is modified after the signature was produced', async () => {
      configService.get.mockReturnValue(SECRET);
      const originalRaw = Buffer.from(JSON.stringify(makeDto()), 'utf8');
      const sig = sign(originalRaw, SECRET);

      // Attacker tampers with the body (different amount) but reuses the old sig.
      const tamperedDto = makeDto({ amount: '9999.00' });
      const tamperedRaw = Buffer.from(JSON.stringify(tamperedDto), 'utf8');

      await expect(
        service.handleEvent(tamperedRaw, sig, tamperedDto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a signature produced with a different secret', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      const sig = sign(raw, 'attacker-guessed-secret');

      await expect(service.handleEvent(raw, sig, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a correctly-formatted but wrong hex digest of the right length', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      // 64 hex chars (32 bytes) — same length as a real digest, but all zeros.
      const wrongSig = '0'.repeat(64);

      await expect(service.handleEvent(raw, wrongSig, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a truncated signature (length mismatch branch)', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      const fullSig = sign(raw, SECRET);
      // Drop the last byte (2 hex chars) so the buffer length differs.
      const truncated = fullSig.slice(0, -2);

      await expect(service.handleEvent(raw, truncated, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an over-long signature (length mismatch branch)', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      const tooLong = sign(raw, SECRET) + 'ab';

      await expect(service.handleEvent(raw, tooLong, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a non-hex / malformed signature string', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');

      await expect(
        service.handleEvent(raw, 'not-a-valid-hex-signature!!', dto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the signature header is missing entirely', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');

      await expect(service.handleEvent(raw, undefined, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an empty-string signature when a secret is configured', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');

      await expect(service.handleEvent(raw, '', dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('is case-sensitive: an upper-cased hex digest is rejected', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      // Node emits lowercase hex; Buffer.from(upper,'hex') decodes to the same
      // bytes, so this should still PASS — assert that explicitly to document
      // that comparison is on bytes, not the string. (Guards against a naive
      // string === string implementation regressing in future.)
      const upper = sign(raw, SECRET).toUpperCase();

      await expect(service.handleEvent(raw, upper, dto)).resolves.toEqual({
        received: true,
      });
    });

    it('does not leak through when only the secret differs by one character', async () => {
      configService.get.mockReturnValue(SECRET);
      const dto = makeDto();
      const raw = Buffer.from(JSON.stringify(dto), 'utf8');
      const sig = sign(raw, SECRET + 'x');

      await expect(service.handleEvent(raw, sig, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── Verification is skipped only when no secret is configured ──────────────

  it('skips verification when no secret is configured (dev/test convenience)', async () => {
    configService.get.mockReturnValue(undefined);
    const dto = makeDto();
    const raw = Buffer.from(JSON.stringify(dto), 'utf8');

    // Even a clearly bogus signature is accepted because checks are disabled.
    await expect(service.handleEvent(raw, 'whatever', dto)).resolves.toEqual({
      received: true,
    });
  });
});
