import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';

async function createDeliveredEscrow(
  prisma: PrismaService,
  repository: EscrowRepository,
  overrides?: Partial<{ id: string }>,
) {
  const id = overrides?.id ?? 'escrow-idempotency-001';
  const pastDelivery = new Date(Date.now() - 50 * 60 * 60 * 1000);
  const base = await prisma.escrow.create({
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
    },
  });
  await repository.markDelivered(base.id, pastDelivery);
  return base.id;
}

describe('Auto-Release Idempotency Key Locking (issue #296)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contractService: ContractService;
  let escrowRepository: EscrowRepository;

  beforeAll(async () => {
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
  });

  beforeEach(async () => {
    await prisma.reset();

    jest
      .spyOn(contractService, 'submitAutoRelease')
      .mockResolvedValue('tx-hash-auto-release-test');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('first claim succeeds and marks the escrow as submitting', async () => {
    const id = await createDeliveredEscrow(prisma, escrowRepository);

    const claimed = await escrowRepository.markAutoReleaseSubmitting(id);

    expect(claimed).not.toBeNull();
    expect(claimed?.autoReleaseSubmittedAt).not.toBeNull();

    const fromDb = await prisma.escrow.findUnique({ where: { id } });
    expect(fromDb?.autoReleaseSubmittedAt).not.toBeNull();
  });

  it('second concurrent claim returns null', async () => {
    const id = await createDeliveredEscrow(prisma, escrowRepository);

    const firstClaim = await escrowRepository.markAutoReleaseSubmitting(id);
    expect(firstClaim).not.toBeNull();

    const secondClaim = await escrowRepository.markAutoReleaseSubmitting(id);
    expect(secondClaim).toBeNull();
  });

  it('lock cleared on failure via clearAutoReleaseSubmitting allows retry', async () => {
    const id = await createDeliveredEscrow(prisma, escrowRepository);

    const claimed = await escrowRepository.markAutoReleaseSubmitting(id);
    expect(claimed).not.toBeNull();

    await escrowRepository.clearAutoReleaseSubmitting(id);

    const fromDb = await prisma.escrow.findUnique({ where: { id } });
    expect(fromDb?.autoReleaseSubmittedAt).toBeNull();

    const retryClaim = await escrowRepository.markAutoReleaseSubmitting(id);
    expect(retryClaim).not.toBeNull();
  });

  it('escrow state remains consistent after lock/unlock cycle', async () => {
    const id = await createDeliveredEscrow(prisma, escrowRepository);

    const claimed = await escrowRepository.markAutoReleaseSubmitting(id);
    expect(claimed?.state).toBe('DELIVERED');

    await escrowRepository.clearAutoReleaseSubmitting(id);

    const afterClear = await prisma.escrow.findUnique({ where: { id } });
    expect(afterClear?.state).toBe('DELIVERED');
    expect(afterClear?.autoReleaseSubmittedAt).toBeNull();
    expect(afterClear?.autoReleaseTxHash).toBeNull();
  });

  it('lock prevents duplicate auto-release transaction submission', async () => {
    const id = await createDeliveredEscrow(prisma, escrowRepository);

    await escrowRepository.markAutoReleaseSubmitting(id);

    const secondClaim = await escrowRepository.markAutoReleaseSubmitting(id);
    expect(secondClaim).toBeNull();

    expect(contractService.submitAutoRelease).not.toHaveBeenCalled();
  });
});
