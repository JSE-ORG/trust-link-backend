import { wrapPrismaWithTracing } from './prisma-tracing.wrapper';
import { TracingService } from './tracing.service';
import { PrismaService } from '../prisma/prisma.service';

describe('prisma-tracing.wrapper', () => {
  let tracing: TracingService;

  beforeEach(() => {
    process.env.OTEL_ENABLED = 'false';
    process.env.NODE_ENV = 'development';
    tracing = new TracingService();
  });

  afterEach(() => {
    delete process.env.OTEL_ENABLED;
  });

  function makeFakePrisma() {
    const fakeClient = {
      escrow: {
        findMany: jest.fn().mockResolvedValue([{ id: '1' }]),
        findUnique: jest.fn().mockResolvedValue({ id: '1' }),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
      },
      dispute: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $connect: jest.fn(),
    } as unknown as PrismaService;
    return fakeClient;
  }

  it('forwards calls transparently through the wrapper', async () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing);

    const result = await wrapped.escrow.findMany({});

    expect(result).toEqual([{ id: '1' }]);
    expect(prisma.escrow.findMany as jest.Mock).toHaveBeenCalled();
  });

  it('passes exact arguments to the wrapped method', async () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing);
    const args = { where: { id: '123' } };

    await wrapped.escrow.findUnique(args);

    expect(prisma.escrow.findUnique as jest.Mock).toHaveBeenCalledWith(args);
  });

  it('returns resolved value unchanged', async () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing);

    const result = await (
      wrapped as unknown as {
        escrow: { create: (args: unknown) => Promise<unknown> };
      }
    ).escrow.create({
      data: { itemName: 'test' },
    });

    expect(result).toEqual({ id: 'new' });
  });

  it('propagates rejection with original error', async () => {
    const prisma = makeFakePrisma();
    const originalError = new Error('DB connection failed');
    (prisma.escrow.findMany as jest.Mock).mockRejectedValueOnce(originalError);
    const wrapped = wrapPrismaWithTracing(prisma, tracing);

    await expect(wrapped.escrow.findMany({})).rejects.toThrow(
      'DB connection failed',
    );
  });

  it('wraps non-traced model methods as bound functions', async () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing) as unknown as Record<
      string,
      unknown
    >;

    expect(typeof wrapped.$connect).toBe('function');
  });

  it('exposes non-function properties through the wrapper', () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing) as unknown as Record<
      string,
      unknown
    >;

    expect(wrapped.$connect).toBeDefined();
  });

  it('wraps all traced model methods', async () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing);

    const findManyResult = await wrapped.escrow.findMany({});
    expect(findManyResult).toEqual([{ id: '1' }]);

    const findUniqueResult = await wrapped.escrow.findUnique({
      where: { id: '1' },
    });
    expect(findUniqueResult).toEqual({ id: '1' });
  });

  it('wraps dispute model methods', async () => {
    const prisma = makeFakePrisma();
    const wrapped = wrapPrismaWithTracing(prisma, tracing);

    const result = await wrapped.dispute.findMany({});
    expect(result).toEqual([]);
  });
});
