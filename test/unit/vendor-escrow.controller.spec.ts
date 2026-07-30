/**
 * Controller-level tests for GET /vendor/escrows (issue #575).
 *
 * `VendorEscrowController` answers "which escrows are mine" for the
 * authenticated vendor. The correctness that matters most is the tenancy
 * boundary — a vendor must never see another vendor's escrows — plus
 * pagination and the reported total matching the row count returned.
 *
 * Follows the same real-guard, mocked-dependency pattern as
 * `api-keys.controller.spec.ts`: JwtGuard runs for real (so an
 * unauthenticated caller is genuinely rejected), and `EscrowService` is
 * mocked so no database is required.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { VendorEscrowController } from '../../src/escrow/vendor-escrow.controller';
import { EscrowService } from '../../src/escrow/escrow.service';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { bearer } from '../auth-helper';

describe('VendorEscrowController (issue #575)', () => {
  let app: INestApplication;
  let escrowService: jest.Mocked<EscrowService>;

  const VENDOR_A = 'GVENDORA000000000000000000000000000000000000000000000';
  const VENDOR_B = 'GVENDORB000000000000000000000000000000000000000000000';

  const summaryFor = (id: string) => ({
    id,
    itemName: 'Sony A7 IV Mirrorless Camera',
    itemRef: 'SKU-CAM-A7IV-001',
    amount: 2499.99,
    currency: 'USDC',
    state: 'SHIPPED',
    trackingId: null,
  });

  beforeEach(async () => {
    escrowService = {
      findVendorEscrows: jest.fn(),
    } as unknown as jest.Mocked<EscrowService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [VendorEscrowController],
      providers: [
        { provide: EscrowService, useValue: escrowService },
        JwtGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/vendor/escrows').expect(401);

    expect(escrowService.findVendorEscrows).not.toHaveBeenCalled();
  });

  describe('tenancy', () => {
    it('looks up escrows for the caller identified by their own token, not another vendor', async () => {
      escrowService.findVendorEscrows.mockImplementation(async (address) => ({
        data: [summaryFor(`escrow-of-${address}`)],
        total: 1,
        page: 1,
        limit: 20,
      }));

      const resA = await request(app.getHttpServer())
        .get('/vendor/escrows')
        .set('Authorization', bearer(VENDOR_A))
        .expect(200);

      expect(escrowService.findVendorEscrows).toHaveBeenLastCalledWith(
        VENDOR_A,
        expect.anything(),
      );
      expect(resA.body.data).toEqual([summaryFor(`escrow-of-${VENDOR_A}`)]);

      const resB = await request(app.getHttpServer())
        .get('/vendor/escrows')
        .set('Authorization', bearer(VENDOR_B))
        .expect(200);

      expect(escrowService.findVendorEscrows).toHaveBeenLastCalledWith(
        VENDOR_B,
        expect.anything(),
      );
      expect(resB.body.data).toEqual([summaryFor(`escrow-of-${VENDOR_B}`)]);

      // Neither vendor's response contains data scoped to the other vendor.
      expect(JSON.stringify(resA.body)).not.toContain(VENDOR_B);
      expect(JSON.stringify(resB.body)).not.toContain(VENDOR_A);
    });
  });

  describe('pagination', () => {
    it('returns the first page with default query params', async () => {
      escrowService.findVendorEscrows.mockResolvedValue({
        data: [summaryFor('escrow-1'), summaryFor('escrow-2')],
        total: 5,
        page: 1,
        limit: 20,
      });

      const res = await request(app.getHttpServer())
        .get('/vendor/escrows')
        .set('Authorization', bearer(VENDOR_A))
        .expect(200);

      expect(escrowService.findVendorEscrows).toHaveBeenCalledWith(
        VENDOR_A,
        expect.objectContaining({ page: 1, limit: 20 }),
      );
      expect(res.body).toEqual({
        data: [summaryFor('escrow-1'), summaryFor('escrow-2')],
        total: 5,
        page: 1,
        limit: 20,
      });
    });

    it('passes through a later page', async () => {
      escrowService.findVendorEscrows.mockResolvedValue({
        data: [summaryFor('escrow-3')],
        total: 5,
        page: 2,
        limit: 2,
      });

      const res = await request(app.getHttpServer())
        .get('/vendor/escrows?page=2&limit=2')
        .set('Authorization', bearer(VENDOR_A))
        .expect(200);

      expect(escrowService.findVendorEscrows).toHaveBeenCalledWith(
        VENDOR_A,
        expect.objectContaining({ page: 2, limit: 2 }),
      );
      expect(res.body.page).toBe(2);
      expect(res.body.data).toEqual([summaryFor('escrow-3')]);
    });

    it('returns an empty page when paging beyond the end, with the true total still reported', async () => {
      escrowService.findVendorEscrows.mockResolvedValue({
        data: [],
        total: 5,
        page: 10,
        limit: 20,
      });

      const res = await request(app.getHttpServer())
        .get('/vendor/escrows?page=10')
        .set('Authorization', bearer(VENDOR_A))
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(5);
    });

    it('reports a total matching the row count, not the returned page size', async () => {
      escrowService.findVendorEscrows.mockResolvedValue({
        data: [summaryFor('escrow-1')],
        total: 47,
        page: 1,
        limit: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/vendor/escrows?limit=1')
        .set('Authorization', bearer(VENDOR_A))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(47);
    });
  });

  describe('invalid input', () => {
    it('rejects an out-of-range limit with 400', async () => {
      await request(app.getHttpServer())
        .get('/vendor/escrows?limit=1000')
        .set('Authorization', bearer(VENDOR_A))
        .expect(400);

      expect(escrowService.findVendorEscrows).not.toHaveBeenCalled();
    });

    it('rejects an invalid state filter with 400', async () => {
      await request(app.getHttpServer())
        .get('/vendor/escrows?state=NOT_A_REAL_STATE')
        .set('Authorization', bearer(VENDOR_A))
        .expect(400);

      expect(escrowService.findVendorEscrows).not.toHaveBeenCalled();
    });
  });
});
