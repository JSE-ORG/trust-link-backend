import crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContractService } from '../src/stellar/contract.service';
import { ConfigService } from '../src/config/config.service';
import { bearer } from './auth-helper';

describe('Dispute Flow E2E (issue #57)', () => {
  let nextContractEscrowId = 1n;
  let app: INestApplication;
  let prisma: PrismaService;
  let contractService: ContractService;
  let adminAddress: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    contractService = app.get(ContractService);
    adminAddress = app.get(ConfigService).get('ADMIN_ADDRESS');

    nextContractEscrowId = 1n;
    await prisma.reset();

    jest
      .spyOn(contractService, 'resolveDispute')
      .mockResolvedValue('tx-hash-dispute-resolved');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('completes full dispute flow from creation to admin resolution with RELEASE', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/escrow')
      .set(
        'Authorization',
        bearer('GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE'),
      )
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Vintage camera',
        itemRef: 'camera-dispute-001',
        amount: 250,
        currency: 'USDC',
        buyerAddress:
          'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK',
      })
      .expect(201);

    const escrowId = createResponse.body.id;
    // resolve_dispute addresses the escrow by the contract's own u64;
    // the HTTP creation flow never sets it, so the test supplies it.
    const contractEscrowId = nextContractEscrowId++;
    await prisma.escrow.update({
      where: { id: escrowId },
      data: { contractEscrowId },
    });

    const disputeResponse = await request(app.getHttpServer())
      .post(`/escrow/${escrowId}/dispute`)
      .set(
        'Authorization',
        bearer('GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK'),
      )
      .send({
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description:
          'The camera lens is scratched and not as described in the listing provided by the vendor',
      })
      .expect(201);

    expect(disputeResponse.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        escrowId,
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description:
          'The camera lens is scratched and not as described in the listing provided by the vendor',
        status: 'OPEN',
      }),
    );

    const disputeId = disputeResponse.body.id;

    const resolveResponse = await request(app.getHttpServer())
      .patch(`/admin/dispute/${escrowId}/resolve`)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .send({ resolution: 'RELEASE' })
      .expect(200);

    expect(resolveResponse.body.state).toBe('COMPLETED');
    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      contractEscrowId,
      'RELEASE',
      expect.any(String),
    );

    const escrowAfter = await prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    expect(escrowAfter?.state).toBe('COMPLETED');

    const disputeAfter = await prisma.dispute.findUnique({
      where: { id: disputeId },
    });
    expect(disputeAfter?.status).toBe('RESOLVED');
    expect(disputeAfter?.resolvedAt).toBeTruthy();
  });

  it('completes full dispute flow from creation to admin resolution with REFUND', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/escrow')
      .set(
        'Authorization',
        bearer('GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE'),
      )
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Leather jacket',
        itemRef: 'jacket-dispute-002',
        amount: 180,
        currency: 'USDC',
        buyerAddress:
          'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK',
      })
      .expect(201);

    const escrowId = createResponse.body.id;
    // resolve_dispute addresses the escrow by the contract's own u64;
    // the HTTP creation flow never sets it, so the test supplies it.
    const contractEscrowId = nextContractEscrowId++;
    await prisma.escrow.update({
      where: { id: escrowId },
      data: { contractEscrowId },
    });

    await request(app.getHttpServer())
      .post(`/escrow/${escrowId}/dispute`)
      .set(
        'Authorization',
        bearer('GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK'),
      )
      .send({
        reason: 'DAMAGED_ITEM',
        description:
          'Item arrived damaged with torn packaging and visible defects',
      })
      .expect(201);

    const resolveResponse = await request(app.getHttpServer())
      .patch(`/admin/dispute/${escrowId}/resolve`)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .send({ resolution: 'REFUND' })
      .expect(200);

    expect(resolveResponse.body.state).toBe('REFUNDED');
    expect(contractService.resolveDispute).toHaveBeenCalledWith(
      contractEscrowId,
      'REFUND',
      expect.any(String),
    );

    const escrowAfter = await prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    expect(escrowAfter?.state).toBe('REFUNDED');
  });

  it('prevents non-participants from opening disputes', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/escrow')
      .set(
        'Authorization',
        bearer('GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE'),
      )
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Watch',
        itemRef: 'watch-001',
        amount: 300,
        currency: 'USDC',
        buyerAddress:
          'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/escrow/${createResponse.body.id}/dispute`)
      .set(
        'Authorization',
        bearer('GCLKIIQCXY62273JIOSH4BKI5LP2W2FTMLSPNACTM2NAIVYXHSREUQSQ'),
      )
      .send({
        reason: 'FRAUD',
        description: 'This is a fraudulent attempt by non-participant',
      })
      .expect(403);
  });

  it('prevents duplicate disputes on same escrow', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/escrow')
      .set(
        'Authorization',
        bearer('GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE'),
      )
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        itemName: 'Headphones',
        itemRef: 'headphones-001',
        amount: 150,
        currency: 'USDC',
        buyerAddress:
          'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK',
      })
      .expect(201);

    const escrowId = createResponse.body.id;
    // resolve_dispute addresses the escrow by the contract's own u64;
    // the HTTP creation flow never sets it, so the test supplies it.
    const contractEscrowId = nextContractEscrowId++;
    await prisma.escrow.update({
      where: { id: escrowId },
      data: { contractEscrowId },
    });

    await request(app.getHttpServer())
      .post(`/escrow/${escrowId}/dispute`)
      .set(
        'Authorization',
        bearer('GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK'),
      )
      .send({
        reason: 'ITEM_NOT_RECEIVED',
        description: 'Item never arrived after 30 days',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/escrow/${escrowId}/dispute`)
      .set(
        'Authorization',
        bearer('GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK'),
      )
      .send({
        reason: 'FRAUD',
        description: 'Attempting to open second dispute',
      })
      .expect(409);
  });
});
