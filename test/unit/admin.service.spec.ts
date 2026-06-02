import { Test } from '@nestjs/testing';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { ContractService } from '../../src/stellar/contract.service';

describe('AdminService (issue #32)', () => {
  let service: AdminService;
  let prisma: jest.Mocked<PrismaService>;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let contractService: jest.Mocked<ContractService>;

  const mockEscrow = {
    id: 'escrow-1',
    itemName: 'Test Item',
    itemRef: 'item-123',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-1',
    vendorAddress: 'vendor-1',
    state: 'FUNDED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockDispute = {
    id: 'dispute-1',
    escrowId: 'escrow-1',
    initiatorAddress: 'buyer-1',
    respondentAddress: 'vendor-1',
    status: 'OPEN',
    reason: 'Item not received',
    evidence: 'missing-evidence',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    prisma = {
      escrow: {
        findMany: jest.fn(),
      },
      dispute: {
        findMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    escrowRepository = {
      findById: jest.fn(),
      markCompleted: jest.fn(),
      markRefunded: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    contractService = {
      resolveDispute: jest.fn(),
    } as unknown as jest.Mocked<ContractService>;

    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: ContractService, useValue: contractService },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  describe('getOpenDisputes', () => {
    it('should return all open and under-review disputes', async () => {
      const disputes = [
        { ...mockDispute, status: 'OPEN' },
        { ...mockDispute, id: 'dispute-2', status: 'UNDER_REVIEW' },
      ];
      prisma.dispute.findMany.mockResolvedValue(disputes as any);

      const result = await service.getOpenDisputes();

      expect(result).toEqual(disputes);
      expect(prisma.dispute.findMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['OPEN', 'UNDER_REVIEW'],
          },
        },
      });
    });

    it('should return empty array if no open disputes exist', async () => {
      prisma.dispute.findMany.mockResolvedValue([]);

      const result = await service.getOpenDisputes();

      expect(result).toEqual([]);
    });
  });

  describe('resolveDispute', () => {
    it('should resolve dispute with RELEASE resolution', async () => {
      const completedEscrow = { ...mockEscrow, state: 'COMPLETED' };
      escrowRepository.findById.mockResolvedValue(mockEscrow as any);
      contractService.resolveDispute.mockResolvedValue(undefined);
      escrowRepository.markCompleted.mockResolvedValue(completedEscrow as any);

      const result = await service.resolveDispute('escrow-1', 'RELEASE');

      expect(result).toEqual(completedEscrow);
      expect(contractService.resolveDispute).toHaveBeenCalledWith(
        'escrow-1',
        'RELEASE',
      );
      expect(escrowRepository.markCompleted).toHaveBeenCalledWith('escrow-1');
    });

    it('should resolve dispute with REFUND resolution', async () => {
      const refundedEscrow = { ...mockEscrow, state: 'REFUNDED' };
      escrowRepository.findById.mockResolvedValue(mockEscrow as any);
      contractService.resolveDispute.mockResolvedValue(undefined);
      escrowRepository.markRefunded.mockResolvedValue(refundedEscrow as any);

      const result = await service.resolveDispute('escrow-1', 'REFUND');

      expect(result).toEqual(refundedEscrow);
      expect(contractService.resolveDispute).toHaveBeenCalledWith(
        'escrow-1',
        'REFUND',
      );
      expect(escrowRepository.markRefunded).toHaveBeenCalledWith('escrow-1');
    });

    it('should throw error if escrow not found', async () => {
      escrowRepository.findById.mockResolvedValue(null);

      await expect(
        service.resolveDispute('escrow-999', 'RELEASE'),
      ).rejects.toThrow('Escrow not found');
    });

    it('should throw error if dispute already resolved', async () => {
      const completedEscrow = { ...mockEscrow, state: 'COMPLETED' };
      escrowRepository.findById.mockResolvedValue(completedEscrow as any);

      await expect(
        service.resolveDispute('escrow-1', 'RELEASE'),
      ).rejects.toThrow('Dispute has already been resolved');
    });
  });

  describe('getPlatformStats', () => {
    it('should return aggregated platform statistics', async () => {
      const escrows = [
        mockEscrow,
        {
          ...mockEscrow,
          id: 'escrow-2',
          amount: 200,
          vendorAddress: 'vendor-2',
          buyerAddress: 'buyer-2',
          state: 'COMPLETED',
        },
      ];
      const disputes = [
        { ...mockDispute, status: 'OPEN' },
        { ...mockDispute, id: 'dispute-2', status: 'CLOSED' },
      ];

      prisma.escrow.findMany.mockResolvedValue(escrows as any);
      prisma.dispute.findMany.mockResolvedValue(disputes as any);

      const result = await service.getPlatformStats();

      expect(result).toEqual({
        totalEscrows: 2,
        totalVolume: 300,
        escrowsByState: {
          FUNDED: 1,
          COMPLETED: 1,
        },
        uniqueVendors: 2,
        uniqueBuyers: 2,
        totalDisputes: 2,
        openDisputes: 1,
        averageEscrowAmount: 150,
      });
    });

    it('should handle empty escrows and disputes', async () => {
      prisma.escrow.findMany.mockResolvedValue([]);
      prisma.dispute.findMany.mockResolvedValue([]);

      const result = await service.getPlatformStats();

      expect(result).toEqual({
        totalEscrows: 0,
        totalVolume: 0,
        escrowsByState: {},
        uniqueVendors: 0,
        uniqueBuyers: 0,
        totalDisputes: 0,
        openDisputes: 0,
        averageEscrowAmount: 0,
      });
    });
  });

  describe('listAllEscrows', () => {
    it('should return paginated escrows', async () => {
      const escrows = Array.from({ length: 30 }, (_, i) => ({
        ...mockEscrow,
        id: `escrow-${i}`,
      }));
      prisma.escrow.findMany.mockResolvedValue(escrows as any);

      const result = await service.listAllEscrows({
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(20);
      expect(result.total).toBe(30);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter escrows by state', async () => {
      const escrows = [
        mockEscrow,
        { ...mockEscrow, id: 'escrow-2', state: 'COMPLETED' },
      ];
      prisma.escrow.findMany.mockResolvedValue(
        escrows.filter((e) => e.state === 'FUNDED') as any,
      );

      const result = await service.listAllEscrows({
        state: 'FUNDED',
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should use default pagination values', async () => {
      const escrows = [mockEscrow];
      prisma.escrow.findMany.mockResolvedValue(escrows as any);

      const result = await service.listAllEscrows({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prisma.escrow.findMany).toHaveBeenCalledWith({ where: undefined });
    });

    it('should handle pagination offset correctly', async () => {
      const escrows = Array.from({ length: 50 }, (_, i) => ({
        ...mockEscrow,
        id: `escrow-${i}`,
      }));
      prisma.escrow.findMany.mockResolvedValue(escrows as any);

      const result = await service.listAllEscrows({
        page: 2,
        limit: 10,
      });

      expect(result.data[0].id).toBe('escrow-10');
      expect(result.data).toHaveLength(10);
      expect(result.total).toBe(50);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });
  });

  describe('listAllDisputes', () => {
    it('should return paginated disputes', async () => {
      const disputes = Array.from({ length: 30 }, (_, i) => ({
        ...mockDispute,
        id: `dispute-${i}`,
      }));
      prisma.dispute.findMany.mockResolvedValue(disputes as any);

      const result = await service.listAllDisputes({
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(20);
      expect(result.total).toBe(30);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter disputes by status', async () => {
      const disputes = [
        { ...mockDispute, status: 'OPEN' },
        { ...mockDispute, id: 'dispute-2', status: 'RESOLVED' },
      ];
      prisma.dispute.findMany.mockResolvedValue(
        disputes.filter((d) => d.status === 'OPEN') as any,
      );

      const result = await service.listAllDisputes({
        status: 'OPEN',
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should use default pagination values', async () => {
      const disputes = [mockDispute];
      prisma.dispute.findMany.mockResolvedValue(disputes as any);

      const result = await service.listAllDisputes({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prisma.dispute.findMany).toHaveBeenCalledWith({ where: undefined });
    });

    it('should handle pagination offset correctly', async () => {
      const disputes = Array.from({ length: 50 }, (_, i) => ({
        ...mockDispute,
        id: `dispute-${i}`,
      }));
      prisma.dispute.findMany.mockResolvedValue(disputes as any);

      const result = await service.listAllDisputes({
        page: 2,
        limit: 10,
      });

      expect(result.data[0].id).toBe('dispute-10');
      expect(result.data).toHaveLength(10);
      expect(result.total).toBe(50);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });
  });
});
