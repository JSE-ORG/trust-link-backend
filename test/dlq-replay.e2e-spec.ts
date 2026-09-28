import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ConfigService } from '../src/config/config.service';
import { DlqService } from '../src/dlq/dlq.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SorobanPollerService } from '../src/stellar/soroban-poller.service';
import { BlockchainListenerService } from '../src/stellar/blockchain-listener.service';
import { bearer } from './auth-helper';
import { ensureVendors } from './prisma-helpers';

const ADMIN_ADDRESS = 'GDLQADMIN001';

describe('DLQ replay flow E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dlq: DlqService;
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
    dlq = app.get(DlqService);
    adminAddress = app.get(ConfigService).get('ADMIN_ADDRESS') || ADMIN_ADDRESS;
    await prisma.reset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  async function createRecordThroughPoller() {
    const poller = app.get(SorobanPollerService);
    const listener = app.get(BlockchainListenerService);
    const cursorService = (
      poller as unknown as {
        cursorService: { set: (cursor: string) => Promise<void> };
      }
    ).cursorService;

    jest.spyOn(listener, 'parseEvent').mockReturnValue(null);
    await cursorService.set('test-cursor');
    jest.spyOn(poller as never, 'fetchEvents' as never).mockResolvedValue([
      {
        id: 'malformed-soroban-event',
        contractId: 'test-contract',
        type: 'contract',
        ledger: 42,
        pagingToken: 'next-cursor',
        topic: [],
        value: 'malformed',
      },
    ] as never);

    await poller.poll();
    const response = await request(app.getHttpServer())
      .get('/admin/dlq')
      .query({ operation: 'soroban_event_sync' })
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);
    expect(response.body.total).toBe(1);
    return response.body.data[0];
  }

  it('creates a DLQ record through a real poller failure and abandons it', async () => {
    const record = await createRecordThroughPoller();

    await request(app.getHttpServer())
      .post(`/admin/dlq/${record.id}/replay`)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(400);

    const abandoned = await request(app.getHttpServer())
      .post(`/admin/dlq/${record.id}/abandon`)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(201);

    expect(abandoned.body.status).toBe('ABANDONED');
  });

  it('replays an escrow without an on-chain id as a conflict', async () => {
    const escrowId = '00000000-0000-0000-0000-000000000001';
    await ensureVendors(prisma, 'GDLQVENDOR001');
    await prisma.escrow.create({
      data: {
        id: escrowId,
        itemName: 'Unfunded replay item',
        itemRef: 'dlq-no-chain-id',
        amount: 10,
        currency: 'USDC',
        buyerAddress: 'GDLQBUYER001',
        vendorAddress: 'GDLQVENDOR001',
      },
    });
    const record = await dlq.enqueue({
      operation: 'submitAutoRelease',
      escrowId,
      errorMessage: 'test failure',
    });

    await request(app.getHttpServer())
      .post(`/admin/dlq/${record.id}/replay`)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(409);
  });
});
