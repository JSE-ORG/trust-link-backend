import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EscrowRepository } from '../src/escrow/escrow.repository';
import { AutoReleaseWorker } from '../src/workers/auto-release.worker';
import { ContractService } from '../src/stellar/contract.service';
import { ensureVendors } from './prisma-helpers';

describe('Auto-Release Worker E2E (issue #59)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: AutoReleaseWorker;
  let contractService: ContractService;
  let escrowRepository: EscrowRepository;

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
    worker = app.get(AutoReleaseWorker);
    contractService = app.get(ContractService);
    escrowRepository = app.get(EscrowRepository);

    await prisma.reset();
    // Escrow.vendorAddress is a foreign key onto VendorProfile.address (#475).
    await ensureVendors(prisma, 'vendor-address', 'vendor-address-2');

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue('tx-hash-auto-release');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  /**
   * Creates a SHIPPED escrow and delivers it through `markDelivered`, the only
   * writer of `deliveredAt` in the application (issue #395). Fields that the
   * delivery transition does not set, such as `autoReleaseTxHash`, are applied
   * afterwards.
   */
  const createDeliveredEscrow = async (
    data: {
      itemName: string;
      itemRef: string;
      amount: number;
      buyerAddress: string;
      vendorAddress: string;
      trackingId: string;
      autoReleaseTxHash?: string;
      disputeId?: string;
    },
    deliveredAt: Date,
  ) => {
    const { autoReleaseTxHash, disputeId, ...rest } = data;
    const escrow = await prisma.escrow.create({
      data: {
        ...rest,
        currency: 'USDC',
        state: 'SHIPPED',
        shippedAt: new Date(deliveredAt.getTime() - 10 * 60 * 60 * 1000),
      },
    });
    await escrowRepository.markDelivered(escrow.id, deliveredAt);
    if (autoReleaseTxHash || disputeId) {
      await prisma.escrow.update({
        where: { id: escrow.id },
        data: {
          ...(autoReleaseTxHash ? { autoReleaseTxHash } : {}),
          ...(disputeId ? { disputeId } : {}),
        },
      });
    }
    return escrow;
  };

  it('processes eligible escrows and submits auto-release transactions', async () => {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

    const escrow1 = await createDeliveredEscrow(
      {
        itemName: 'Camera',
        itemRef: 'camera-auto-001',
        amount: 250,
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        trackingId: 'TRK-001',
      },
      pastDelivery,
    );

    const escrow2 = await createDeliveredEscrow(
      {
        itemName: 'Laptop',
        itemRef: 'laptop-auto-001',
        amount: 1200,
        buyerAddress: 'buyer-address-2',
        vendorAddress: 'vendor-address-2',
        trackingId: 'TRK-002',
      },
      pastDelivery,
    );

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
    expect(escrow1After?.state).toBe('DELIVERED');
    expect(escrow1After?.autoReleaseTxHash).toBe('tx-hash-auto-release');
    expect(escrow1After?.autoReleaseSubmittedAt).toBeTruthy();

    const escrow2After = await prisma.escrow.findUnique({
      where: { id: escrow2.id },
    });
    expect(escrow2After?.state).toBe('DELIVERED');
    expect(escrow2After?.autoReleaseTxHash).toBe('tx-hash-auto-release');
  });

  it('skips escrows with active disputes', async () => {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

    const escrow = await createDeliveredEscrow(
      {
        itemName: 'Phone',
        itemRef: 'phone-dispute-001',
        amount: 800,
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        trackingId: 'TRK-003',
      },
      pastDelivery,
    );

    const dispute = await prisma.dispute.create({
      data: {
        escrowId: escrow.id,
        reason: 'ITEM_NOT_AS_DESCRIBED',
        description: 'Phone has defects',
        status: 'OPEN',
      },
    });
    // Mirror production: BuyerDisputeService links the dispute and transitions
    // the escrow. The in-memory PrismaService applied that inside
    // dispute.create itself, so the test got it for free; the real client does
    // not (#475).
    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { disputeId: dispute.id, state: 'DISPUTED' },
    });

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();

    const escrowAfter = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    // The escrow was transitioned to DISPUTED above, so it no longer matches
    // the state/disputeId filters in findAutoReleaseEligible.
    expect(escrowAfter?.state).toBe('DISPUTED');
    expect(escrowAfter?.autoReleaseTxHash).toBeNull();
  });

  it('skips escrows delivered less than 48 hours ago', async () => {
    const recentDelivery = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await createDeliveredEscrow(
      {
        itemName: 'Tablet',
        itemRef: 'tablet-recent-001',
        amount: 400,
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        trackingId: 'TRK-004',
      },
      recentDelivery,
    );

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });

  it('skips escrows already auto-released', async () => {
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);

    await createDeliveredEscrow(
      {
        itemName: 'Monitor',
        itemRef: 'monitor-released-001',
        amount: 300,
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        trackingId: 'TRK-005',
        autoReleaseTxHash: 'existing-tx-hash',
      },
      pastDelivery,
    );

    await worker.run();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });
});
