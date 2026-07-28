import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../../test/auth-helper';

describe('Vendor account details (issue #484)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_A = 'GVENDORACCOUNTDETAILSA';
  const VENDOR_B = 'GVENDORACCOUNTDETAILSB';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Match the production validation policy. Silently stripping an unexpected
    // field is not sufficient for an endpoint accepting regulated data.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not let vendor A read vendor B account details', async () => {
    await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_A))
      .send({ bankAccountNumber: '1111222233334444' })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_B))
      .send({ bankAccountNumber: '9999888877776666' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_A))
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        vendorAddress: VENDOR_A,
        bankAccountNumber: '************4444',
      }),
    );
    expect(response.body.vendorAddress).not.toBe(VENDOR_B);
    expect(response.body.bankAccountNumber).not.toContain('6666');
  });

  it('masks bank account numbers and tax identifiers in update and get responses', async () => {
    const accountNumber = '1234567890123456';
    const taxId = 'TAX-123456789';

    const updateResponse = await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_A))
      .send({ bankAccountNumber: accountNumber, taxId })
      .expect(200);

    const getResponse = await request(app.getHttpServer())
      .get('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_A))
      .expect(200);

    for (const response of [updateResponse, getResponse]) {
      expect(response.body.bankAccountNumber).toBe('************3456');
      expect(response.body.taxId).toBe('*********6789');
      expect(response.body.bankAccountNumber).not.toContain(accountNumber);
      expect(response.body.taxId).not.toContain(taxId);
    }
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/vendor/account-details')
      .expect(401);

    await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .send({ bankAccountNumber: '1234567890123456' })
      .expect(401);
  });

  it('rejects unknown request fields', async () => {
    const response = await request(app.getHttpServer())
      .patch('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_A))
      .send({ bankAccountNumber: '1234567890123456', kycStatus: 'APPROVED' })
      .expect(400);

    expect(response.body.message).toContain(
      'property kycStatus should not exist',
    );
  });

  it('returns null when the authenticated vendor has no account details', async () => {
    const response = await request(app.getHttpServer())
      .get('/vendor/account-details')
      .set('Authorization', bearer(VENDOR_A))
      .expect(200);

    // Nest serializes a controller `null` return as an empty 200 response.
    expect(response.text).toBe('');
  });
});
