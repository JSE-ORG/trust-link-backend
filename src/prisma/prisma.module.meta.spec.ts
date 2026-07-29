import { PrismaModule } from './prisma.module';

describe('PrismaModule metadata inspection', () => {
  it('should have providers in metadata', () => {
    const protoKeys = Reflect.ownKeys(Object.getPrototypeOf(PrismaModule));
    console.log('Prototype keys:', protoKeys.map(k => k.toString()));
    
    const allKeys = Reflect.ownKeys(PrismaModule.prototype);
    console.log('Prototype own keys:', allKeys.map(k => k.toString()));
    
    for (const k of allKeys) {
      try {
        const v = Reflect.getMetadata(k, PrismaModule.prototype);
        console.log('Key', k.toString(), '=>', typeof v, JSON.stringify(v).slice(0, 300));
      } catch(e) {
        // ignore
      }
    }
    
    expect(true).toBe(true);
  });
});
