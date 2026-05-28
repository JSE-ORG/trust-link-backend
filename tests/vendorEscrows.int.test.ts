import { PrismaClient, EscrowState } from '@prisma/client';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { Decimal } from '@prisma/client/runtime/library';

// 1. Setup Express app, routing, and controllers matching Express/Fastify compatibility
const app = express();
app.use(express.json());

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/escrow_test?schema=public',
    },
  },
});

// Mock authentication middleware signature expected by the endpoint
interface AuthenticatedRequest extends Request {
  user?: {
    address: string;
  };
}

const mockAuthMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  // Simple mock bypass: token is treated as the vendor address
  req.user = { address: token };
  next();
};

// GET /vendor/escrows controller
app.get('/vendor/escrows', mockAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vendorAddress = req.user?.address;
    if (!vendorAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { state, sort, order, page, limit } = req.query;

    // Vendor isolation assertion parameter
    // If request wants to query another vendor's data or check invalid context
    const reqVendor = req.headers['x-query-vendor-address'] as string;
    if (reqVendor && reqVendor !== vendorAddress) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Validation & Sorting whitelist
    const allowedSortColumns = ['createdAt', 'amount'];
    const sortColumn = allowedSortColumns.includes(sort as string) ? (sort as string) : 'createdAt';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    // Pagination
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Filter construction
    const whereClause: any = {
      vendorAddress: reqVendor || vendorAddress,
    };

    if (state) {
      if (!Object.values(EscrowState).includes(state as EscrowState)) {
        return res.status(400).json({ error: 'Invalid state parameter' });
      }
      whereClause.state = state as EscrowState;
    }

    const [escrows, total] = await prisma.$transaction([
      prisma.escrow.findMany({
        where: whereClause,
        orderBy: {
          [sortColumn]: sortOrder,
        },
        skip,
        take: limitNum,
      }),
      prisma.escrow.count({
        where: whereClause,
      }),
    ]);

    return res.status(200).json({
      data: escrows,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

describe('GET /vendor/escrows Integration Tests', () => {
  const vendorAddressA = 'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6';
  const vendorAddressB = 'GBRPDO4JDHPUC253QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6VND';
  const buyerAddress = 'GDBW53QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY18274L2P';

  beforeAll(async () => {
    // Connect database
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Truncate tables to guarantee test isolation
    await prisma.notification.deleteMany();
    await prisma.dispute.deleteMany();
    await prisma.escrow.deleteMany();

    // Seed exactly 10 test escrows across multiple states
    const testEscrows = [
      // Vendor A
      { itemName: 'Item 1', itemRef: 'REF-1', amount: new Decimal('100.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.SHIPPED },
      { itemName: 'Item 2', itemRef: 'REF-2', amount: new Decimal('250.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.SHIPPED },
      { itemName: 'Item 3', itemRef: 'REF-3', amount: new Decimal('50.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.CREATED },
      { itemName: 'Item 4', itemRef: 'REF-4', amount: new Decimal('500.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.FUNDED },
      { itemName: 'Item 5', itemRef: 'REF-5', amount: new Decimal('75.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.DELIVERED },
      { itemName: 'Item 6', itemRef: 'REF-6', amount: new Decimal('150.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.COMPLETED },
      { itemName: 'Item 7', itemRef: 'REF-7', amount: new Decimal('300.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.REFUNDED },
      { itemName: 'Item 8', itemRef: 'REF-8', amount: new Decimal('20.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressA, state: EscrowState.DISPUTED },
      // Vendor B
      { itemName: 'Item 9', itemRef: 'REF-9', amount: new Decimal('800.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressB, state: EscrowState.SHIPPED },
      { itemName: 'Item 10', itemRef: 'REF-10', amount: new Decimal('90.00'), currency: 'USD', buyerAddress, vendorAddress: vendorAddressB, state: EscrowState.FUNDED },
    ];

    for (const escrowData of testEscrows) {
      await prisma.escrow.create({
        data: escrowData,
      });
    }
  });

  afterAll(async () => {
    // Teardown connections
    await prisma.$disconnect();
  });

  it('should filter escrows by state (state=SHIPPED)', async () => {
    const res = await request(app)
      .get('/vendor/escrows')
      .set('Authorization', `Bearer ${vendorAddressA}`)
      .query({ state: 'SHIPPED' })
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.data.length).toBe(2);
    res.body.data.forEach((escrow: any) => {
      expect(escrow.state).toBe('SHIPPED');
      expect(escrow.vendorAddress).toBe(vendorAddressA);
    });
  });

  it('should sort escrows by amount desc', async () => {
    const res = await request(app)
      .get('/vendor/escrows')
      .set('Authorization', `Bearer ${vendorAddressA}`)
      .query({ sort: 'amount', order: 'desc' })
      .expect(200);

    expect(res.body.data.length).toBe(8);
    const amounts = res.body.data.map((e: any) => parseFloat(e.amount));
    for (let i = 0; i < amounts.length - 1; i++) {
      expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i + 1]);
    }
  });

  it('should handle pagination cleanly (page=2, limit=3)', async () => {
    const res = await request(app)
      .get('/vendor/escrows')
      .set('Authorization', `Bearer ${vendorAddressA}`)
      .query({ page: 2, limit: 3 })
      .expect(200);

    expect(res.body.total).toBe(8);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(3);
    expect(res.body.data.length).toBe(3);
  });

  it('should enforce vendor isolation and return only vendor matching data', async () => {
    // Vendor B queries their own data
    const resB = await request(app)
      .get('/vendor/escrows')
      .set('Authorization', `Bearer ${vendorAddressB}`)
      .expect(200);

    expect(resB.body.total).toBe(2);
    resB.body.data.forEach((escrow: any) => {
      expect(escrow.vendorAddress).toBe(vendorAddressB);
    });

    // Querying another vendor's data via parameter override yields empty/403
    await request(app)
      .get('/vendor/escrows')
      .set('Authorization', `Bearer ${vendorAddressA}`)
      .set('x-query-vendor-address', vendorAddressB)
      .expect(403);
  });
});
