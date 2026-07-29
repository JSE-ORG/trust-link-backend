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
import { ApiKeysController } from '../../src/admin/api-keys/api-keys.controller';
import { LogisticsService } from '../../src/logistics/logistics.service';
import { RotateApiKeyDto } from '../../src/admin/api-keys/dto/rotate-api-key.dto';

describe('ApiKeysController (issue #498)', () => {
  function buildDto(key: string): RotateApiKeyDto {
    const dto = new RotateApiKeyDto();
    dto.key = key;
    return dto;
  }

  it('rotates to the submitted key on first set (no key previously configured)', async () => {
    const logisticsService = new LogisticsService();
    const controller = new ApiKeysController(logisticsService);

    expect(logisticsService.getApiKey()).toBeNull();

    const result = await controller.rotateLogisticsKey(
      buildDto('brand-new-key'),
    );

    expect(logisticsService.getApiKey()).toBe('brand-new-key');
    expect(result).toEqual({
      message: 'Logistics API key updated and encrypted',
    });
  });

  it('rotates to the submitted key when a key already exists, instead of re-encrypting the old one', async () => {
    const logisticsService = new LogisticsService();
    const controller = new ApiKeysController(logisticsService);

    await controller.rotateLogisticsKey(buildDto('compromised-old-key'));
    expect(logisticsService.getApiKey()).toBe('compromised-old-key');
    const encryptedBefore = logisticsService.getEncryptedApiKey();

    await controller.rotateLogisticsKey(buildDto('brand-new-replacement-key'));

    // The endpoint must actually use the submitted key, not silently keep
    // re-encrypting the compromised one.
    expect(logisticsService.getApiKey()).toBe('brand-new-replacement-key');
    expect(logisticsService.getEncryptedApiKey()).not.toBe(encryptedBefore);
  });

  it('does not echo the submitted key (or any part of it) in the response', async () => {
    const logisticsService = new LogisticsService();
    const controller = new ApiKeysController(logisticsService);

    const secretKey = 'super-secret-value-should-not-leak';
    const result = await controller.rotateLogisticsKey(buildDto(secretKey));

    expect(JSON.stringify(result)).not.toContain(secretKey);
  });
});
