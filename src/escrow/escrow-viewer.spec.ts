import { NotFoundException } from '@nestjs/common';
import { EscrowService } from './escrow.service';

const BUYER = 'GBUYER000000000000000000000000000000000000000000000000000';
const VENDOR = 'GVENDOR00000000000000000000000000000000000000000000000000';
const OTHER = 'GOTHER000000000000000000000000000000000000000000000000000';

const baseEscrow = {
  id: 'escrow-uuid-1',
  itemName: 'Test Item',
  itemRef: 'REF-001',
  amount: 100,
  currency: 'USDC',
  state: 'FUNDED' as const,
  trackingId: null,
  shippedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  buyerAddress: BUYER,
  vendorAddress: VENDOR,
};

function makeService(escrow = baseEscrow): Partial<EscrowService> {
  return {
    findById: jest.fn().mockResolvedValue(escrow),
    getEscrowForViewer: jest
      .fn()
      .mockImplementation(async (id: string, callerAddress?: string) => {
        const record = escrow;
        const base = {
          id: record.id,
          itemName: record.itemName,
          itemRef: record.itemRef,
          amount: record.amount,
          currency: record.currency,
          state: record.state,
          trackingId: record.trackingId,
          shippedAt: record.shippedAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
        if (!callerAddress) return base;
        return {
          ...base,
          viewer: {
            isBuyer: record.buyerAddress === callerAddress,
            isVendor: record.vendorAddress === callerAddress,
          },
        };
      }),
  };
}

describe('EscrowService.getEscrowForViewer', () => {
  it('returns public data with no viewer field for anonymous callers', async () => {
    const svc = makeService();
    const result = await svc.getEscrowForViewer!('escrow-uuid-1', undefined);
    expect(result).not.toHaveProperty('viewer');
    expect(result.id).toBe('escrow-uuid-1');
  });

  it('sets isBuyer=true and isVendor=false for the buyer', async () => {
    const svc = makeService();
    const result = await svc.getEscrowForViewer!('escrow-uuid-1', BUYER);
    expect(result.viewer).toEqual({ isBuyer: true, isVendor: false });
  });

  it('sets isBuyer=false and isVendor=true for the vendor', async () => {
    const svc = makeService();
    const result = await svc.getEscrowForViewer!('escrow-uuid-1', VENDOR);
    expect(result.viewer).toEqual({ isBuyer: false, isVendor: true });
  });

  it('sets both flags false for an unrelated authenticated caller', async () => {
    const svc = makeService();
    const result = await svc.getEscrowForViewer!('escrow-uuid-1', OTHER);
    expect(result.viewer).toEqual({ isBuyer: false, isVendor: false });
  });
});
