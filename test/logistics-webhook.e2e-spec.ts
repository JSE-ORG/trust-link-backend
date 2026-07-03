import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrackingPollWorker } from '../src/workers/tracking-poll.worker';
import { LogisticsService } from '../src/logistics/logistics.service';
import { ContractService } from '../src/stellar/contract.service';

describe('Logistics Webhook Delivery Update E2E (issue #61)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: TrackingPollWorker;
  let logisticsService: LogisticsService;
  let contractService: ContractService;

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
    worker = app.get(TrackingPollWorker);
    logisticsService = app.get(LogisticsService);
    contractService = app.get(ContractService);

    await prisma.reset();

    jest
      .spyOn(contractService, 'recordDelivery')
      .mockResolvedValue('tx-hash-delivery');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('updates escrow state when logistics webhook reports delivery', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Keyboard',
        itemRef: 'keyboard-webhook-001',
        amount: 120,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        state: 'SHIPPED',
        trackingId: 'TRK-WEBHOOK-001',
        shippedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    });

    jest.spyOn(logisticsService, 'getStatus').mockResolvedValue({
      status: 'DELIVERED' as const,
      events: [],
    });

    await worker.run();

    expect(logisticsService.getStatus).toHaveBeenCalledWith('TRK-WEBHOOK-001');
    expect(contractService.recordDelivery).toHaveBeenCalledWith(escrow.id);

    const escrowAfter = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    expect(escrowAfter?.state).toBe('DELIVERED');
    expect(escrowAfter?.deliveredAt).toBeTruthy();
    expect(escrowAfter?.deliveryRecordedAt).toBeTruthy();
  });

  it('processes multiple shipments with different statuses', async () => {
    const escrow1 = await prisma.escrow.create({
      data: {
        itemName: 'Mouse',
        itemRef: 'mouse-001',
        amount: 50,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        state: 'SHIPPED',
        trackingId: 'TRK-DELIVERED-001',
        shippedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    const escrow2 = await prisma.escrow.create({
      data: {
        itemName: 'Webcam',
        itemRef: 'webcam-001',
        amount: 80,
        currency: 'USDC',
        buyerAddress: 'buyer-address-2',
        vendorAddress: 'vendor-address-2',
        state: 'SHIPPED',
        trackingId: 'TRK-IN-TRANSIT-001',
        shippedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });

    jest
      .spyOn(logisticsService, 'getStatus')
      .mockImplementation(async (trackingId: string) => {
        if (trackingId === 'TRK-DELIVERED-001') {
          return { status: 'DELIVERED' as const, events: [] };
        }
        return { status: 'IN_TRANSIT' as const, events: [] };
      });

    await worker.run();

    const escrow1After = await prisma.escrow.findUnique({
      where: { id: escrow1.id },
    });
    expect(escrow1After?.state).toBe('DELIVERED');
    expect(escrow1After?.deliveredAt).toBeTruthy();

    const escrow2After = await prisma.escrow.findUnique({
      where: { id: escrow2.id },
    });
    expect(escrow2After?.state).toBe('SHIPPED');
    expect(escrow2After?.deliveredAt).toBeNull();
  });

  it('handles logistics service errors gracefully', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Headset',
        itemRef: 'headset-error-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        state: 'SHIPPED',
        trackingId: 'TRK-ERROR-001',
        shippedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
    });

    jest
      .spyOn(logisticsService, 'getStatus')
      .mockRejectedValue(new Error('Logistics API unavailable'));

    await expect(worker.run()).resolves.not.toThrow();

    expect(contractService.recordDelivery).not.toHaveBeenCalled();
  });

  it('skips escrows without tracking IDs', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Speaker',
        itemRef: 'speaker-no-tracking-001',
        amount: 150,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        state: 'SHIPPED',
        trackingId: null,
        shippedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    jest.spyOn(logisticsService, 'getStatus');

    await worker.run();

    expect(logisticsService.getStatus).not.toHaveBeenCalled();
  });

  it('updates interface instantly when delivery status changes', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Microphone',
        itemRef: 'mic-instant-001',
        amount: 90,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        state: 'SHIPPED',
        trackingId: 'TRK-INSTANT-001',
        shippedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      },
    });

    jest.spyOn(logisticsService, 'getStatus').mockResolvedValue({
      status: 'DELIVERED' as const,
      events: [],
    });

    const beforeUpdate = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    expect(beforeUpdate?.state).toBe('SHIPPED');

    await worker.run();

    const afterUpdate = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    expect(afterUpdate?.state).toBe('DELIVERED');
    expect(afterUpdate?.deliveredAt).toBeTruthy();

    const timeDiff =
      afterUpdate!.deliveredAt!.getTime() - beforeUpdate!.updatedAt.getTime();
    expect(timeDiff).toBeLessThan(5000);
  });
});
