/**
 * Integration tests for PATCH /admin/credentials/logistics (issue #776).
 *
 * Exercises ApiKeysController over HTTP against a real database, so admin
 * authorisation, DTO validation and encrypted persistence of the rotated
 * logistics credential are covered together rather than behind a mocked
 * LogisticsService.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { decryptCredential } from '../../src/common/sanitization/credential-encryption.util';
import { ConfigService } from '../../src/config/config.service';
import { LOGISTICS_CREDENTIAL_PROVIDER } from '../../src/logistics/logistics.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';

const ROUTE = '/admin/credentials/logistics';
const NEW_KEY = 'tl_live_integration_rotated_key_0001';

describe('PATCH /admin/credentials/logistics (issue #776)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let adminAddress: string;
  let encryptionKey: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    configService = app.get(ConfigService);
    adminAddress = configService.get('ADMIN_ADDRESS');
    encryptionKey = configService.get<string>('CREDENTIAL_ENCRYPTION_KEY');
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  function storedCredential() {
    return prisma.providerCredential.findUnique({
      where: { provider: LOGISTICS_CREDENTIAL_PROVIDER },
    });
  }

  // ── Successful rotation ─────────────────────────────────────────────────

  it('rotates the key and stores it encrypted, not as plaintext', async () => {
    const res = await request(app.getHttpServer())
      .patch(ROUTE)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .send({ key: NEW_KEY })
      .expect(200);

    expect(res.body).toEqual({
      message: 'Logistics API key updated and encrypted',
    });

    const row = await storedCredential();
    expect(row).not.toBeNull();
    expect(row!.encryptedKey).not.toEqual(NEW_KEY);
    expect(row!.encryptedKey).not.toContain(NEW_KEY);
    expect(row!.encryptedKey).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

    // The ciphertext must round-trip to the submitted key with the configured
    // encryption key, proving it is the rotated value and not a placeholder.
    expect(decryptCredential(row!.encryptedKey, encryptionKey)).toEqual(
      NEW_KEY,
    );
  });

  it('replaces a previously stored key on a second rotation', async () => {
    const server = app.getHttpServer();
    const auth = bearer(adminAddress, { role: 'admin' });

    await request(server)
      .patch(ROUTE)
      .set('Authorization', auth)
      .send({ key: 'tl_live_first_key' })
      .expect(200);
    const first = await storedCredential();

    await request(server)
      .patch(ROUTE)
      .set('Authorization', auth)
      .send({ key: NEW_KEY })
      .expect(200);
    const second = await storedCredential();

    expect(second!.encryptedKey).not.toEqual(first!.encryptedKey);
    expect(decryptCredential(second!.encryptedKey, encryptionKey)).toEqual(
      NEW_KEY,
    );
    expect(await prisma.providerCredential.count()).toBe(1);
  });

  // ── Authorisation ───────────────────────────────────────────────────────

  it('rejects a non-admin caller with 403 and stores nothing', async () => {
    const nonAdmin = Keypair.random().publicKey();

    await request(app.getHttpServer())
      .patch(ROUTE)
      .set('Authorization', bearer(nonAdmin))
      .send({ key: NEW_KEY })
      .expect(403);

    expect(await storedCredential()).toBeNull();
  });

  it('rejects a non-admin caller even when the token claims the admin role', async () => {
    const nonAdmin = Keypair.random().publicKey();

    await request(app.getHttpServer())
      .patch(ROUTE)
      .set('Authorization', bearer(nonAdmin, { role: 'admin' }))
      .send({ key: NEW_KEY })
      .expect(403);

    expect(await storedCredential()).toBeNull();
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer())
      .patch(ROUTE)
      .send({ key: NEW_KEY })
      .expect(401);

    expect(await storedCredential()).toBeNull();
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it.each([
    ['a missing key', {}],
    ['an empty key', { key: '' }],
    ['a non-string key', { key: 12345 }],
  ])('rejects %s with 400 and stores nothing', async (_label, body) => {
    await request(app.getHttpServer())
      .patch(ROUTE)
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .send(body)
      .expect(400);

    expect(await storedCredential()).toBeNull();
  });
});
