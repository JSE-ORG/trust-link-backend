import {
  ADMIN_ESCROW_CSV_COLUMNS,
  csvCell,
  escrowsToCsv,
} from '../../src/escrow/escrow-csv';
import { EscrowService } from '../../src/escrow/escrow.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { ESCROW_EXPORT_MAX_ROWS } from '../../src/escrow/escrow.constants';
import type { EscrowRecord } from '../../src/prisma/prisma.service';
import { createTracingMock } from './tracing-mock';

function escrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'e-1',
    contractEscrowId: null,
    itemName: 'Camera',
    itemRef: 'SKU-1',
    amount: 2499.99,
    currency: 'USDC',
    buyerAddress: 'GBUYER',
    vendorAddress: 'GVENDOR',
    state: 'SHIPPED',
    trackingId: null,
    trackingCheckedAt: null,
    shippedAt: new Date('2026-03-02T10:00:00Z'),
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    buyerContactEmail: 'secret',
    buyerContactPhone: 'secret',
    cancelledAt: null,
    createdAt: new Date('2026-03-01T09:00:00Z'),
    updatedAt: new Date('2026-03-02T10:00:00Z'),
    ...overrides,
  };
}

describe('escrowsToCsv', () => {
  it('writes the header row and one row per escrow, without contact fields', () => {
    const csv = escrowsToCsv([escrow()]);

    expect(csv.split('\r\n')).toEqual([
      'id,itemName,itemRef,amount,currency,state,buyerAddress,createdAt,shippedAt,deliveredAt',
      'e-1,Camera,SKU-1,2499.99,USDC,SHIPPED,GBUYER,2026-03-01T09:00:00.000Z,2026-03-02T10:00:00.000Z,',
      '',
    ]);
    expect(csv).not.toContain('secret');
  });

  it('adds vendorAddress for the admin column list', () => {
    const csv = escrowsToCsv([escrow()], ADMIN_ESCROW_CSV_COLUMNS);

    expect(csv.split('\r\n')).toEqual([
      'id,itemName,itemRef,amount,currency,state,buyerAddress,vendorAddress,createdAt,shippedAt,deliveredAt',
      'e-1,Camera,SKU-1,2499.99,USDC,SHIPPED,GBUYER,GVENDOR,2026-03-01T09:00:00.000Z,2026-03-02T10:00:00.000Z,',
      '',
    ]);
    expect(csv).not.toContain('secret');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'escapes a cell starting with %j against formula injection',
    (prefix) => {
      expect(csvCell(`${prefix}SUM(A1)`).replace(/^"/, '')).toMatch(/^'/);
    },
  );

  it('quotes cells holding commas, quotes or newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
  });
});

describe('EscrowService.exportVendorEscrowsCsv', () => {
  it(`asks for at most ${ESCROW_EXPORT_MAX_ROWS} rows, scoped to the vendor, with the list filters`, async () => {
    const repo = {
      findEscrows: jest
        .fn()
        .mockResolvedValue({ data: [escrow()], total: 50_000 }),
    } as unknown as jest.Mocked<EscrowRepository>;
    const service = new EscrowService(
      createTracingMock().service,
      repo,
      {} as never,
      {} as never,
      {} as never,
    );

    const csv = await service.exportVendorEscrowsCsv('GVENDOR', {
      state: 'SHIPPED',
      q: 'cam',
      buyerAddress: 'GBUYER',
      page: 7,
      limit: 5,
    });

    expect(repo.findEscrows).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorAddress: 'GVENDOR',
        state: 'SHIPPED',
        q: 'cam',
        buyerAddress: 'GBUYER',
      }),
      'date',
      'desc',
      1,
      ESCROW_EXPORT_MAX_ROWS,
    );
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });
});
