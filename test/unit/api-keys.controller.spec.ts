import { RotateApiKeyDto } from '../../src/admin/api-keys/dto/rotate-api-key.dto';
import { ApiKeysController } from '../../src/admin/api-keys/api-keys.controller';
import { LogisticsService } from '../../src/logistics/logistics.service';

describe('ApiKeysController (issue #410) — business logic', () => {
  let logisticsService: LogisticsService;
  let controller: ApiKeysController;

  function buildDto(key: string): RotateApiKeyDto {
    const dto = new RotateApiKeyDto();
    dto.key = key;
    return dto;
  }

  beforeEach(() => {
    logisticsService = new LogisticsService();
    controller = new ApiKeysController(logisticsService);
  });

  it('accepts a key and never leaks credential values in response', async () => {
    const result = await controller.rotateLogisticsKey(buildDto('very-secret-key'));

    expect(result).toEqual({ message: 'Logistics API key updated and encrypted' });
    expect(JSON.stringify(result)).not.toContain('very-secret-key');
    expect(logisticsService.getApiKey()).toBe('very-secret-key');
  });

  it('rotates existing encrypted key via reencryptCredential without leaking secrets', async () => {
    // First set a key
    const util = jest.requireActual('../../src/common/sanitization/credential-encryption.util');
    const spy = jest.spyOn(util, 'reencryptCredential').mockReturnValue('reencrypted:val');

    logisticsService.setEncryptedApiKey('old:enc:key');

    const result = await controller.rotateLogisticsKey(buildDto('should-not-be-used'));

    expect(result).toEqual({ message: 'Logistics API key updated and encrypted' });
    expect(spy).toHaveBeenCalledWith('old:enc:key');
    expect(JSON.stringify(result)).not.toContain('old:enc:key');

    spy.mockRestore();
  });
});

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
