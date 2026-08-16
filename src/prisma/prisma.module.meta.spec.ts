import { Test } from '@nestjs/testing';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule wiring.
 *
 * This file previously printed reflection metadata to the console and asserted
 * `expect(true).toBe(true)` — debug scaffolding that covered nothing. It now
 * pins the two properties that actually matter: the module exports
 * PrismaService for other modules to inject, and PrismaService is still
 * constructable as a plain provider (the shape #489 broke by dropping
 * @Optional() from its injected database URL).
 */
describe('PrismaModule wiring', () => {
  it('exports PrismaService so other modules can inject it', () => {
    const exports = Reflect.getMetadata('exports', PrismaModule) as unknown[];

    expect(exports).toContain(PrismaService);
  });

  it('is constructable as a plain provider, without the module', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    // Prisma v7 exposes the client through a Proxy, so instanceof cannot see
    // the subclass; check the constructor name and a service-only method.
    const prisma = moduleRef.get(PrismaService);
    expect(prisma.constructor.name).toBe('PrismaService');
    expect(typeof prisma.reset).toBe('function');
  });
});
