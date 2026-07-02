import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';

describe('Auto-Release Idempotency Key Locking (issue #296)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    contractService = app.get(ContractService);
    escrowRepository = app.get(EscrowRepository);

    await prisma.reset();

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue('tx-hash-auto-release-test');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  function createShippedEscrow(overrides?: Partial<{ id: string }>) {
    const id = overrides?.id ?? 'escrow-idempotency-001';
    const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);
    return prisma.escrow.create({
      data: {
        id,
        itemName: 'Test Item',
        itemRef: `ref-${id}`,
        amount: 200,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
        vendorAddress: 'vendor-address',
        state: 'SHIPPED',
        trackingId: 'TRK-001',
        shippedAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
        deliveredAt: pastDelivery,
        deliveryRecordedAt: pastDelivery,
      },
    });
  }

  it('first claim succeeds and marks the escrow as submitting', async () => {
    const escrow = await createShippedEscrow();

    const claimed = await escrowRepository.markAutoReleaseSubmitting(escrow.id);

    expect(claimed).not.toBeNull();
    expect(claimed?.autoReleaseSubmittedAt).not.toBeNull();

    const fromDb = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    expect(fromDb?.autoReleaseSubmittedAt).not.toBeNull();
  });

  it('second concurrent claim returns null', async () => {
    const escrow = await createShippedEscrow();

    const firstClaim = await escrowRepository.markAutoReleaseSubmitting(
      escrow.id,
    );
    expect(firstClaim).not.toBeNull();

    const secondClaim = await escrowRepository.markAutoReleaseSubmitting(
      escrow.id,
    );
    expect(secondClaim).toBeNull();
  });

  it('lock cleared on failure via clearAutoReleaseSubmitting allows retry', async () => {
    const escrow = await createShippedEscrow();

    const claimed = await escrowRepository.markAutoReleaseSubmitting(escrow.id);
    expect(claimed).not.toBeNull();

    await escrowRepository.clearAutoReleaseSubmitting(escrow.id);

    const fromDb = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    expect(fromDb?.autoReleaseSubmittedAt).toBeNull();

    const retryClaim = await escrowRepository.markAutoReleaseSubmitting(
      escrow.id,
    );
    expect(retryClaim).not.toBeNull();
  });

  it('escrow state remains consistent after lock/unlock cycle', async () => {
    const escrow = await createShippedEscrow();

    const claimed = await escrowRepository.markAutoReleaseSubmitting(escrow.id);
    expect(claimed?.state).toBe('SHIPPED');

    await escrowRepository.clearAutoReleaseSubmitting(escrow.id);

    const afterClear = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    expect(afterClear?.state).toBe('SHIPPED');
    expect(afterClear?.autoReleaseSubmittedAt).toBeNull();
    expect(afterClear?.autoReleaseTxHash).toBeNull();
  });

  it('lock prevents duplicate auto-release transaction submission', async () => {
    const escrow = await createShippedEscrow();

    await escrowRepository.markAutoReleaseSubmitting(escrow.id);

    const secondClaim = await escrowRepository.markAutoReleaseSubmitting(
      escrow.id,
    );
    expect(secondClaim).toBeNull();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });
});
