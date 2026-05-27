/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * SEP-10 authentication flow — end-to-end integration tests.
 *
 * The full flow under test:
 *   GET /auth?account=<G...>  →  { transaction: "<base64-xdr>" }
 *   POST /auth { transaction: "<signed-base64-xdr>" }  →  { token: "<jwt>" }
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Keypair,
  Networks,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Sep10Service } from '../../src/auth/sep10/sep10.service';

describe('SEP-10 authentication (issue #23)', () => {
  let app: INestApplication;
  let sep10Service: Sep10Service;
  /** A fresh client keypair per test run. */
  const clientKeypair = Keypair.random();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    sep10Service = moduleFixture.get(Sep10Service);
  });

  afterAll(async () => {
    await app.close();
  });

  // ── helpers ─────────────────────────────────────────────────────────────

  async function getChallenge(account: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/auth')
      .query({ account })
      .expect(200);
    return res.body.transaction as string;
  }

  function signChallenge(challengeXdr: string): string {
    const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET);
    tx.sign(clientKeypair);
    return tx.toEnvelope().toXDR('base64').toString();
  }

  // ── tests ────────────────────────────────────────────────────────────────

  it('challenge is returned as valid XDR', async () => {
    const challengeXdr = await getChallenge(clientKeypair.publicKey());

    // Must be a non-empty base64 string that parses as a Stellar transaction
    expect(typeof challengeXdr).toBe('string');
    expect(challengeXdr.length).toBeGreaterThan(0);

    // Parsing throws if the XDR is not a valid Stellar transaction
    expect(() =>
      TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET),
    ).not.toThrow();
  });

  it('signing the challenge and verifying it returns a JWT', async () => {
    const challengeXdr = await getChallenge(clientKeypair.publicKey());
    const signedXdr = signChallenge(challengeXdr);

    const res = await request(app.getHttpServer())
      .post('/auth')
      .send({ transaction: signedXdr })
      .expect(201);

    const { token } = res.body as { token: string };
    expect(typeof token).toBe('string');
    // A JWT has three base64url segments separated by dots
    expect(token.split('.')).toHaveLength(3);
  });

  it('replaying a used challenge returns 401', async () => {
    // Use a fresh keypair so this test is independent of the one above
    const kp = Keypair.random();
    const challengeXdr = await getChallenge(kp.publicKey());
    const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET);
    tx.sign(kp);
    const signedXdr = tx.toEnvelope().toXDR('base64').toString();

    // First use — should succeed
    await request(app.getHttpServer())
      .post('/auth')
      .send({ transaction: signedXdr })
      .expect(201);

    // Replay — must be rejected
    await request(app.getHttpServer())
      .post('/auth')
      .send({ transaction: signedXdr })
      .expect(401);
  });

  it('expired challenge returns 401', async () => {
    const kp = Keypair.random();

    // Build a challenge whose maxTime is already in the past (timeout = -700s).
    // The SDK adds a 300-second grace window, so we need maxTime + 300 < now,
    // i.e. (now - 700) + 300 = now - 400 < now  ✓
    const expiredXdr = sep10Service.buildChallenge(kp.publicKey(), -700);

    const tx = TransactionBuilder.fromXDR(expiredXdr, Networks.TESTNET);
    tx.sign(kp);
    const signedXdr = tx.toEnvelope().toXDR('base64').toString();

    await request(app.getHttpServer())
      .post('/auth')
      .send({ transaction: signedXdr })
      .expect(401);
  });

  it('forged signature returns 401', async () => {
    const kp = Keypair.random();
    const challengeXdr = await getChallenge(kp.publicKey());

    // Sign with a DIFFERENT keypair — the server expects `kp`'s signature
    const attacker = Keypair.random();
    const tx = TransactionBuilder.fromXDR(challengeXdr, Networks.TESTNET);
    tx.sign(attacker);
    const forgedXdr = tx.toEnvelope().toXDR('base64').toString();

    await request(app.getHttpServer())
      .post('/auth')
      .send({ transaction: forgedXdr })
      .expect(401);
  });
});
