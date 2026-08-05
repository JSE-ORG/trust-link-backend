import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'Float',
  'Decimal',
  'DateTime',
  'Boolean',
  'BigInt',
  'Json',
  'EscrowState',
  'DisputeStatus',
]);

function requiredScalarFields(schema: string, model: string): string[] {
  const blockMatch = schema.match(
    new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\}`),
  );
  if (!blockMatch) {
    throw new Error(`Model ${model} not found in schema`);
  }

  const fields: string[] = [];
  for (const rawLine of blockMatch[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

    const [name, type] = line.split(/\s+/);
    if (!name || !type) continue;

    if (type.endsWith('?') || type.endsWith('[]')) continue;
    const baseType = type.replace(/[?[\]]/g, '');
    if (!SCALAR_TYPES.has(baseType)) continue;

    fields.push(name);
  }
  return fields;
}

describe('PrismaService parity with Prisma schema', () => {
  const schema = readFileSync(
    join(__dirname, '../../prisma/schema.prisma'),
    'utf8',
  );
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    await prisma.vendorProfile.createMany({
      data: [{ address: 'vendor-1', businessName: 'Acme' }],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  it('escrow records contain every required Escrow schema column', async () => {
    const required = requiredScalarFields(schema, 'Escrow');
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Camera',
        itemRef: 'SKU-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
      },
    });

    for (const field of required) {
      expect(escrow[field as keyof typeof escrow]).toBeDefined();
    }
  });

  it('creates escrow with itemRef', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Camera',
        itemRef: 'SKU-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
      },
    });
    expect(escrow.itemRef).toBe('SKU-1');
  });

  it('dispute records contain every required Dispute schema column', async () => {
    const required = requiredScalarFields(schema, 'Dispute');
    await prisma.escrow.create({
      data: {
        id: 'escrow-1',
        itemName: 'Camera',
        itemRef: 'SKU-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
      },
    });
    const dispute = await prisma.dispute.create({
      data: { escrowId: 'escrow-1', reason: 'Item missing' },
    });

    for (const field of required) {
      expect(dispute[field as keyof typeof dispute]).toBeDefined();
    }
    expect(dispute.description).toBeDefined();
    expect(Array.isArray(dispute.evidenceUrls)).toBe(true);
  });

  it('vendor profile records contain every required VendorProfile column', async () => {
    const required = requiredScalarFields(schema, 'VendorProfile');
    const profile = await prisma.vendorProfile.upsert({
      where: { address: 'vendor-1' },
      create: {
        address: 'vendor-1',
        businessName: 'Acme',
        description: '',
        email: '',
        phone: '',
      },
      update: {
        businessName: 'Acme',
        description: '',
        email: '',
        phone: '',
      },
    });

    for (const field of required) {
      expect(profile[field as keyof typeof profile]).toBeDefined();
    }
  });

  it('vendor tracking settings contain every required VendorTrackingSettings column', async () => {
    const required = requiredScalarFields(schema, 'VendorTrackingSettings');
    const settings = await prisma.vendorTrackingSettings.upsert({
      where: { vendorAddress: 'vendor-1' },
      create: { vendorAddress: 'vendor-1' },
      update: {},
    });

    for (const field of required) {
      expect(settings[field as keyof typeof settings]).toBeDefined();
    }
  });
});
