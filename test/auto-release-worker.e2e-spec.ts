import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EscrowRepository } from '../src/escrow/escrow.repository';
import { AutoReleaseWorker } from '../src/workers/auto-release.worker';
import { ContractService } from '../src/stellar/contract.service';

async function createDeliveredEscrow(
  prisma: PrismaService,
  repository: EscrowRepository,
  overrides: {
    itemName: string;
    itemRef: string;
    amount: number;
    buyerAddress: string;
    vendorAddress: string;
    trackingId: string;
    shippedAt: Date;
    deliveredAt: Date;
    autoReleaseTxHash?: string;
  },
) {
  const base = await prisma.escrow.create({
    data: {
      itemName: overrides.itemName,
      itemRef: overrides.itemRef,
      amount: overrides.amount,
      currency: 'USDC',
      buyerAddress: overrides.buyerAddress,
      vendorAddress: overrides.vendorAddress,
      state: 'SHIPPED',
      trackingId: overrides.trackingId,
      shippedAt: overrides.shippedAt,
    },
  });
  let escrow = await repository.markDelivered(base.id, overrides.deliveredAt);
  if (overrides.autoReleaseTxHash) {
    escrow = await prisma.escrow.update({
      where: { id: escrow.id },
      data: { autoReleaseTxHash: overrides.autoReleaseTxHash },
    });
  }
  return escrow;
}

describe('Auto-Release Worker E2E (issue #59)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let escrowRepository: EscrowRepository;
  let worker: AutoReleaseWorker;
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
    escrowRepository = app.get(EscrowRepository);
    worker = app.get(AutoReleaseWorker);
    contractService = app.get(ContractService);

    await prisma.reset();

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue('tx-hash-auto-release');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('processes eligible escrows and submits auto-release transactions', async () => {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

    const escrow1 = await createDeliveredEscrow(prisma, escrowRepository, {
      itemName: 'Camera',
      itemRef: 'camera-auto-001',
      amount: 250,
      buyerAddress: 'buyer-address',
      vendorAddress: 'vendor-address',
      trackingId: 'TRK-001',
      shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
      deliveredAt: pastDelivery,
    });

    const escrow2 = await createDeliveredEscrow(prisma, escrowRepository, {
      itemName: 'Laptop',
      itemRef: 'laptop-auto-001',
      amount: 1200,
      buyerAddress: 'buyer-address-2',
      vendorAddress: 'vendor-address-2',
      trackingId: 'TRK-002',
      shippedAt: new Date(Date.now() - 55 * 60 * 60 * 1000),
      deliveredAt: pastDelivery,
    });

    await worker.run();

    expect(contractService.submitAutoRelease).toHaveBeenCalledTimes(2);
    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
      escrow1.id,
      expect.any(String),
    );
    expect(contractService.submitAutoRelease).toHaveBeenCalledWith(
      escrow2.id,
      expect.any(String),
    );

    const escrow1After = await prisma.escrow.findUnique({
      where: { id: escrow1.id },
    });
    expect(escrow1After?.state).toBe('RELEASED');
    expect(escrow1After?.autoReleaseTxHash).toBe('tx-hash-auto-release');
    expect(escrow1After?.autoReleaseSubmittedAt).toBeTruthy();

    const escrow2After = await prisma.escrow.findUnique({
      where: { id: escrow2.id },
    });
    expect(escrow2After?.state).toBe('RELEASED');
    expect(escrow2After?.autoReleaseTxHash).toBe('tx-hash-auto-release');
  });

  it('skips escrows with active disputes', async () => {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

    const escrow = await createDeliveredEscrow(prisma, escrowRepository, {
      itemName: 'Phone',
      itemRef: 'phone-dispute-001',
      amount: 800,
      buyerAddress: 'buyer-address',
      vendorAddress: 'vendor-address',
      trackingId: 'TRK-003',
      shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
      deliveredAt: pastDelivery,
    });

    await prisma.dispute.create({
      data: {
        escrowId: escrow.id,
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description: 'Phone has defects',
        status: 'OPEN',
      },
    });

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();

    const escrowAfter = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    // Creating the dispute transitions the linked escrow to DISPUTED as a
    // side effect (see PrismaService.dispute.create) — the worker's
    // dispute-open check makes this redundant with the state/disputeId
    // filters in findAutoReleaseEligible, but the escrow is no longer DELIVERED.
    expect(escrowAfter?.state).toBe('DISPUTED');
    expect(escrowAfter?.autoReleaseTxHash).toBeNull();
  });

  it('skips escrows delivered less than 48 hours ago', async () => {
    const recentDelivery = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await createDeliveredEscrow(prisma, escrowRepository, {
      itemName: 'Tablet',
      itemRef: 'tablet-recent-001',
      amount: 400,
      buyerAddress: 'buyer-address',
      vendorAddress: 'vendor-address',
      trackingId: 'TRK-004',
      shippedAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      deliveredAt: recentDelivery,
    });

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  it('skips escrows already auto-released', async () => {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

    await createDeliveredEscrow(prisma, escrowRepository, {
      itemName: 'Monitor',
      itemRef: 'monitor-released-001',
      amount: 300,
      buyerAddress: 'buyer-address',
      vendorAddress: 'vendor-address',
      trackingId: 'TRK-005',
      shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
      deliveredAt: pastDelivery,
      autoReleaseTxHash: 'existing-tx-hash',
    });

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });
});
