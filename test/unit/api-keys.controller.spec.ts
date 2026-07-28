import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeysController } from '../../src/admin/api-keys/api-keys.controller';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { AdminGuard } from '../../src/admin/guards/admin.guard';
import { ConfigService } from '../../src/config/config.service';

describe('ApiKeysController (issue #410)', () => {
  let app: INestApplication;
  let logisticsService: any;

  const ADMIN = 'admin-address';

  beforeEach(async () => {
    logisticsService = {
      getEncryptedApiKey: jest.fn(),
      setApiKey: jest.fn(),
      setEncryptedApiKey: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        { provide: LogisticsService, useValue: logisticsService },
        JwtGuard,
        AdminGuard,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(ADMIN) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for a non-admin caller', async () => {
    await request(app.getHttpServer())
      .patch('/admin/credentials/logistics')
      .set('Authorization', '******')
      .send({ key: 'does-not-matter' })
      .expect(403);
  });

  it('accepts admin and never leaks credential values in response', async () => {
    // Ensure branch where there is no current encrypted key (first-time set)
    logisticsService.getEncryptedApiKey.mockReturnValue(null);
    logisticsService.setApiKey.mockImplementation((k: string) => {
      // On set, pretend an encrypted value is now available
      logisticsService.getEncryptedApiKey.mockReturnValue('enc:val:here');
    });

    const res = await request(app.getHttpServer())
      .patch('/admin/credentials/logistics')
      .set('Authorization', '******')
      .send({ key: 'very-secret-key' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Logistics API key updated and encrypted' });
    // ensure raw credential never echoed back
    expect(JSON.stringify(res.body)).not.toContain('very-secret-key');

    expect(logisticsService.setApiKey).toHaveBeenCalledWith('very-secret-key');
    expect(logisticsService.setEncryptedApiKey).toHaveBeenCalledWith('enc:val:here');
  });

  it('rotates existing encrypted key via reencryptCredential without leaking secrets', async () => {
    // Provide an existing encrypted key; spy on reencryptCredential
    const util = await import('../../src/common/sanitization/credential-encryption.util');
    const spy = jest.spyOn(util, 'reencryptCredential').mockReturnValue('reencrypted:val');

    logisticsService.getEncryptedApiKey.mockReturnValue('old:enc:key');

    const res = await request(app.getHttpServer())
      .patch('/admin/credentials/logistics')
      .set('Authorization', '******')
      .send({ key: 'should-not-be-used' })
      .expect(200);

    expect(res.body).toEqual({ message: 'Logistics API key updated and encrypted' });
    expect(spy).toHaveBeenCalledWith('old:enc:key');
    expect(logisticsService.setEncryptedApiKey).toHaveBeenCalledWith('reencrypted:val');
    expect(JSON.stringify(res.body)).not.toContain('old:enc:key');

    spy.mockRestore();
  });
});
