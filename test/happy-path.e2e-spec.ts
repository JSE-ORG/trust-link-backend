import crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContractService } from '../src/stellar/contract.service';
import { AutoReleaseWorker } from '../src/workers/auto-release.worker';
import { EscrowRepository } from '../src/escrow/escrow.repository';
import { EscrowService } from '../src/escrow/escrow.service';
import { bearer } from './auth-helper';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VENDOR_ADDRESS =
  'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER_ADDRESS =
  'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';

describe('Happy-Path E2E — full escrow lifecycle (issue #56)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let escrowRepository: EscrowRepository;
  let contractService: ContractService;
  let autoReleaseWorker: AutoReleaseWorker;
  let escrowService: EscrowService;

  // Issue #494 changed escrow creation to start in CREATED, not FUNDED.
  // There is no HTTP endpoint for funding — in production it happens via
  // SorobanPollerService observing an on-chain payment and calling
  // EscrowService.syncStateFromChain directly (see
  // src/stellar/soroban-poller.service.ts). Tests that need a FUNDED escrow
  // drive it through that same real code path rather than writing the state
  // into Postgres by hand, so this also exercises the notifyFunded call and
  // the funded-at bookkeeping that syncStateFromChain performs.
  async function fundEscrow(escrowId: string): Promise<void> {
    const result = await escrowService.syncStateFromChain({
      eventType: 'EscrowFunded',
      escrowId,
    });
    if (result.skipped) {
      throw new Error(
        `fundEscrow: syncStateFromChain skipped (${result.reason}) for ${escrowId}`,
      );
    }
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    escrowRepository = app.get(EscrowRepository);
    contractService = app.get(ContractService);
    autoReleaseWorker = app.get(AutoReleaseWorker);
    escrowService = app.get(EscrowService);

    await prisma.reset();

    // Stub out every ContractService method that hits the real Stellar network.
    jest
      .spyOn(contractService, 'getEscrowState')
      .mockResolvedValue({ exists: false, state: 'CREATED' });
    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue('tx-hash-auto-release-001');
    jest
      .spyOn(contractService, 'recordDelivery')
      .mockResolvedValue('tx-hash-delivery-001');
    jest
      .spyOn(contractService, 'cancelEscrowOnChain')
      .mockResolvedValue('tx-hash-cancel-001');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ── Main happy path ────────────────────────────────────────────────────────

  it('completes the full escrow lifecycle: create → contact → ship → deliver → auto-release', async () => {
    // ── 1. Vendor creates escrow ───────────────────────────────────────────
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Sony WH-1000XM5 Headphones',
        itemRef: 'happy-path-001',
        amount: 350,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    const escrowId: string = createRes.body.id;
    expect(escrowId).toBeDefined();
    expect(createRes.body.state).toBe('CREATED');

    // DB sanity check
    const created = await prisma.escrow.findUnique({ where: { id: escrowId } });
    expect(created?.state).toBe('CREATED');
    expect(created?.vendorAddress).toBe(VENDOR_ADDRESS);
    expect(created?.buyerAddress).toBe(BUYER_ADDRESS);

    // ── 2. Buyer submits contact info before payment ───────────────────────
    const contactRes = await request(app.getHttpServer())
      .patch(`/escrow/${escrowId}/buyer-contact`)
      .send({ email: 'buyer@example.com', phone: '+2348012345678' })
      .expect(200);

    expect(contactRes.body.message).toBe('Buyer contact information saved.');

    // Contact fields must be stored encrypted — never plaintext, never exposed
    const afterContact = await prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    expect(afterContact?.buyerContactEmail).toBeDefined();
    expect(afterContact?.buyerContactEmail).not.toBe('buyer@example.com');
    expect(afterContact?.buyerContactPhone).toBeDefined();
    expect(afterContact?.buyerContactPhone).not.toBe('+2348012345678');
    expect(afterContact?.state).toBe('CREATED');

    // ── 2b. Buyer pays — the on-chain poller observes the payment and syncs
    // the escrow to FUNDED (issue #494/#549) ───────────────────────────────
    await fundEscrow(escrowId);

    // ── 3. GET /escrow/:id must not expose contact fields ─────────────────
    const publicRes = await request(app.getHttpServer())
      .get(`/escrow/${escrowId}`)
      .expect(200);

    expect(publicRes.body).not.toHaveProperty('buyerContactEmail');
    expect(publicRes.body).not.toHaveProperty('buyerContactPhone');
    expect(publicRes.body.id).toBe(escrowId);
    expect(publicRes.body.state).toBe('FUNDED');

    // ── 4. Vendor ships the order ──────────────────────────────────────────
    const shipRes = await request(app.getHttpServer())
      .patch(`/escrow/${escrowId}/ship`)
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .send({ trackingId: 'TRK-XM5-HAPPY-001' })
      .expect(200);

    expect(shipRes.body.state).toBe('SHIPPED');
    expect(shipRes.body.trackingId).toBe('TRK-XM5-HAPPY-001');

    const shipped = await prisma.escrow.findUnique({ where: { id: escrowId } });
    expect(shipped?.state).toBe('SHIPPED');
    expect(shipped?.trackingId).toBe('TRK-XM5-HAPPY-001');
    expect(shipped?.shippedAt).toBeTruthy();

    // ── 5. Delivery recorded (simulates TrackingPollWorker outcome) ────────
    // Driven through the same repository method the worker calls, rather than
    // a raw Prisma update, so the row this test hands to auto-release is the
    // row production would produce (#395).
    await escrowRepository.markDelivered(escrowId, new Date());

    const delivered = await prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    expect(delivered?.state).toBe('DELIVERED');
    expect(delivered?.deliveredAt).toBeTruthy();

    // ── 6. Auto-release worker submits the transaction ─────────────────────
    // Back-date deliveredAt past the 48-hour threshold so the worker picks it
    // up. The state stays DELIVERED: this step used to roll it back to SHIPPED
    // to make the worker fire, which was the eligibility bug (#395) being
    // papered over in the one test that drives the whole lifecycle.
    const pastDelivery = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await prisma.escrow.update({
      where: { id: escrowId },
      data: { deliveredAt: pastDelivery },
    });

    await autoReleaseWorker.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
      escrowId,
      expect.any(String),
    );

    // Submission is not confirmation: the worker records the hash and stops.
    const submitted = await prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    expect(submitted?.state).toBe('DELIVERED');
    expect(submitted?.autoReleaseTxHash).toBe('tx-hash-auto-release-001');

    // ── 7. The AutoReleased chain event finalises the escrow ───────────────
    // In production SorobanPollerService observes the contract event and calls
    // this. It is what confirms the transaction landed, so it owns the
    // terminal transition and the completion notification.
    await escrowService.syncStateFromChain({
      eventType: 'AutoReleased',
      escrowId,
      txHash: 'tx-hash-auto-release-001',
    });

    const released = await prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    expect(released?.state).toBe('RELEASED');
    expect(released?.autoReleaseTxHash).toBe('tx-hash-auto-release-001');

    // ── 8. Notification rows written for all key transitions ───────────────
    // COMPLETED is asserted last because notifyCompleted is fired without
    // await on the sync path, so the row lands just after syncStateFromChain
    // resolves.
    await new Promise((resolve) => setImmediate(resolve));
    const notifications = await prisma.notification.findMany();
    const types = notifications.map((n) => n.type);
    expect(types).toContain('FUNDED');
    expect(types).toContain('SHIPPED');
    expect(types).toContain('COMPLETED');
  });

  // ── Buyer contact: email-only ──────────────────────────────────────────────

  it('accepts buyer contact with email only', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Test Item Email Only',
        itemRef: 'happy-path-email-only',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/escrow/${createRes.body.id}/buyer-contact`)
      .send({ email: 'buyer@example.com' })
      .expect(200);

    const record = await prisma.escrow.findUnique({
      where: { id: createRes.body.id },
    });
    expect(record?.buyerContactEmail).toBeDefined();
    expect(record?.buyerContactPhone).toBeNull();
  });

  // ── Buyer contact: phone-only ──────────────────────────────────────────────

  it('accepts buyer contact with phone only', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Test Item Phone Only',
        itemRef: 'happy-path-phone-only',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/escrow/${createRes.body.id}/buyer-contact`)
      .send({ phone: '+2348012345678' })
      .expect(200);

    const record = await prisma.escrow.findUnique({
      where: { id: createRes.body.id },
    });
    expect(record?.buyerContactPhone).toBeDefined();
    expect(record?.buyerContactEmail).toBeNull();
  });

  // ── Buyer contact: neither field provided ──────────────────────────────────

  it('rejects buyer contact with neither email nor phone', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Test Item No Contact',
        itemRef: 'happy-path-no-contact',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/escrow/${createRes.body.id}/buyer-contact`)
      .send({})
      .expect(400);
  });

  // ── Buyer contact: invalid email format ───────────────────────────────────

  it('rejects buyer contact with invalid email', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Test Item Bad Email',
        itemRef: 'happy-path-bad-email',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/escrow/${createRes.body.id}/buyer-contact`)
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  // ── Buyer contact: terminal state guard ───────────────────────────────────

  it('rejects buyer contact update on a cancelled escrow', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Test Item Cancelled',
        itemRef: 'happy-path-cancelled',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    const escrowId: string = createRes.body.id;

    // Issue #549: the escrow is CREATED (not FUNDED) at this point, so the
    // FUNDED-only PATCH /escrow/:id/cancel is the wrong endpoint here — the
    // CREATED-only DELETE /escrow/:id (cancelPendingEscrow) is what
    // actually cancels it.
    await request(app.getHttpServer())
      .delete(`/escrow/${escrowId}`)
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/escrow/${escrowId}/buyer-contact`)
      .send({ email: 'buyer@example.com' })
      .expect(409);
  });

  // ── Vendor cannot ship without FUNDED state ───────────────────────────────

  it('rejects shipment on an already-shipped escrow', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Test Item Double Ship',
        itemRef: 'happy-path-double-ship',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(201);

    const escrowId: string = createRes.body.id;

    // Issue #549: shipment requires FUNDED; fund it through the real sync
    // path first so the *first* ship succeeds and the test actually
    // exercises "already shipped", not "not yet funded".
    await fundEscrow(escrowId);

    await request(app.getHttpServer())
      .patch(`/escrow/${escrowId}/ship`)
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .send({ trackingId: 'TRK-FIRST-001' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/escrow/${escrowId}/ship`)
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .send({ trackingId: 'TRK-SECOND-001' })
      .expect(409);
  });

  // ── Duplicate item ref blocked ─────────────────────────────────────────────

  it('rejects duplicate escrow for the same vendor and item reference', async () => {
    const payload = {
      itemName: 'Duplicate Item',
      itemRef: 'happy-path-dup-ref',
      amount: 200,
      currency: 'USDC',
      buyerAddress: BUYER_ADDRESS,
    };

    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_ADDRESS))
      .set('Idempotency-Key', crypto.randomUUID())
      .send(payload)
      .expect(409);
  });

  // ── Unauthenticated requests rejected ─────────────────────────────────────

  it('rejects escrow creation without a Bearer token', async () => {
    await request(app.getHttpServer())
      .post('/escrow')
      .send({
        itemName: 'No Auth Item',
        itemRef: 'no-auth-ref',
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
      })
      .expect(401);
  });
});
