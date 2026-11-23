import { NotFoundException } from '@nestjs/common';
import { AdminEscrowsService } from './admin-escrows.service';
import { EscrowRepository } from '../../escrow/escrow.repository';
import { ESCROW_EXPORT_MAX_ROWS } from '../../escrow/escrow.constants';
import { EscrowStateEnum } from '../../common/enums/escrow-state.enum';
import type { DisputeRecord, EscrowRecord } from '../../prisma/prisma.service';

function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'escrow-1',
    contractEscrowId: BigInt('9007199254740993'),
    itemName: 'Widget',
    itemRef: 'REF-1',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'GBUYER001',
    vendorAddress: 'GVENDOR001',
    state: 'FUNDED',
    trackingId: null,
    carrier: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    buyerContactEmail: 'enc:email:secret',
    buyerContactPhone: 'enc:phone:secret',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminEscrowsService', () => {
  let repo: jest.Mocked<
    Pick<EscrowRepository, 'findEscrows' | 'findByIdWithDispute'>
  >;
  let service: AdminEscrowsService;

  beforeEach(() => {
    repo = {
      findEscrows: jest.fn(),
      findByIdWithDispute: jest.fn(),
    };
    service = new AdminEscrowsService(repo as unknown as EscrowRepository);
  });

  describe('list', () => {
    it('strips contacts and stringifies BigInt contractEscrowId', async () => {
      const withBigInt = makeEscrow({
        id: 'escrow-bigint',
        contractEscrowId: BigInt('9007199254740993'),
        buyerContactEmail: 'enc:buyer@example.com',
        buyerContactPhone: 'enc:+15551234567',
      });
      const withNull = makeEscrow({
        id: 'escrow-null',
        contractEscrowId: null,
        buyerContactEmail: 'enc:other@example.com',
        buyerContactPhone: 'enc:+15557654321',
      });

      repo.findEscrows.mockResolvedValue({
        data: [withBigInt, withNull],
        total: 2,
      });

      const result = await service.list({});

      expect(result.data).toHaveLength(2);
      expect(result.data[0].contractEscrowId).toBe('9007199254740993');
      expect(result.data[1].contractEscrowId).toBeNull();

      for (const row of result.data) {
        expect('buyerContactEmail' in row).toBe(false);
        expect('buyerContactPhone' in row).toBe(false);
      }
    });

    it('applies default paging and sort parameters when omitted', async () => {
      repo.findEscrows.mockResolvedValue({ data: [], total: 0 });

      const result = await service.list({});

      expect(repo.findEscrows).toHaveBeenCalledWith(
        {
          state: undefined,
          vendorAddress: undefined,
          buyerAddress: undefined,
          from: undefined,
          to: undefined,
          q: undefined,
        },
        'date',
        'desc',
        1,
        20,
      );
      expect(result).toMatchObject({
        total: 0,
        page: 1,
        limit: 20,
      });
    });

    it('forwards explicit filters, sort, order, page, and limit', async () => {
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-02-01T00:00:00.000Z';
      repo.findEscrows.mockResolvedValue({ data: [], total: 0 });

      await service.list({
        state: EscrowStateEnum.FUNDED,
        vendorAddress: 'GVENDOR',
        buyerAddress: 'GBUYER',
        from,
        to,
        q: 'widget',
        sort: 'amount',
        order: 'asc',
        page: 3,
        limit: 50,
      });

      expect(repo.findEscrows).toHaveBeenCalledWith(
        {
          state: EscrowStateEnum.FUNDED,
          vendorAddress: 'GVENDOR',
          buyerAddress: 'GBUYER',
          from,
          to,
          q: 'widget',
        },
        'amount',
        'asc',
        3,
        50,
      );
    });
  });

  describe('exportCsv', () => {
    it('caps export at ESCROW_EXPORT_MAX_ROWS ignoring paging', async () => {
      const escrow = makeEscrow({ id: 'escrow-csv' });
      repo.findEscrows.mockResolvedValue({ data: [escrow], total: 1 });

      const csv = await service.exportCsv({ page: 5, limit: 10 });

      expect(repo.findEscrows).toHaveBeenCalledWith(
        {
          state: undefined,
          vendorAddress: undefined,
          buyerAddress: undefined,
          from: undefined,
          to: undefined,
          q: undefined,
        },
        'date',
        'desc',
        1,
        ESCROW_EXPORT_MAX_ROWS,
      );
      expect(csv).toContain('escrow-csv');
      expect(csv).not.toContain('enc:email:secret');
      expect(csv).not.toContain('enc:phone:secret');
    });
  });

  describe('get', () => {
    it('returns the sanitized admin view with dispute attached', async () => {
      const escrow = makeEscrow({
        id: 'escrow-42',
        contractEscrowId: BigInt(42),
      });
      const dispute: DisputeRecord = {
        id: 'dispute-1',
        escrowId: 'escrow-42',
        reason: 'Damaged item',
        description: 'Package arrived broken',
        evidenceUrls: [],
        status: 'OPEN',
        resolvedAt: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      repo.findByIdWithDispute.mockResolvedValue({ escrow, dispute });

      const result = await service.get('escrow-42');

      expect(result.id).toBe('escrow-42');
      expect(result.contractEscrowId).toBe('42');
      expect(result.dispute).toEqual(dispute);
      expect('buyerContactEmail' in result).toBe(false);
      expect('buyerContactPhone' in result).toBe(false);
    });

    it('throws 404 when the escrow does not exist', async () => {
      repo.findByIdWithDispute.mockResolvedValue(null);

      await expect(service.get('missing-id')).rejects.toThrow(
        new NotFoundException('Escrow missing-id not found'),
      );
    });
  });
});
