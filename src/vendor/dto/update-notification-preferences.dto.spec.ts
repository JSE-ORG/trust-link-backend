import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateNotificationPreferencesDto } from './update-notification-preferences.dto';

function toDto(
  plain: Record<string, unknown>,
): UpdateNotificationPreferencesDto {
  return plainToInstance(UpdateNotificationPreferencesDto, plain);
}

async function errors(plain: Record<string, unknown>): Promise<string[]> {
  const dto = toDto(plain);
  const result = await validate(dto);
  return result.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('UpdateNotificationPreferencesDto transforms and validation (#1228)', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    expect(await errors({})).toHaveLength(0);
  });

  describe('notificationChannels @Transform and validation', () => {
    it('uppercases lowercase channel strings before enum validation', async () => {
      const dto = toDto({ notificationChannels: ['email', 'sms'] });
      expect(dto.notificationChannels).toEqual(['EMAIL', 'SMS']);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('passes non-array notificationChannels through unchanged so @IsArray rejects it', async () => {
      const dto = toDto({ notificationChannels: 'email' });
      expect(dto.notificationChannels).toBe('email');
      const errs = await validate(dto);
      expect(errs.map((e) => e.property)).toContain('notificationChannels');
    });

    it('rejects empty array and array with more than 2 channels', async () => {
      expect(
        (await errors({ notificationChannels: [] })).length,
      ).toBeGreaterThan(0);
      expect(
        (await errors({ notificationChannels: ['EMAIL', 'SMS', 'EMAIL'] }))
          .length,
      ).toBeGreaterThan(0);
    });

    it('rejects unknown notification channels even after uppercasing', async () => {
      const errs = await errors({ notificationChannels: ['push'] });
      expect(errs.length).toBeGreaterThan(0);
    });
  });

  describe('webhookUrl and webhookSecret @Transform', () => {
    it('trims surrounding whitespace on webhookUrl and webhookSecret', async () => {
      const dto = toDto({
        webhookUrl: '  https://example.com/hook  ',
        webhookSecret: '  super-secret-key  ',
      });
      expect(dto.webhookUrl).toBe('https://example.com/hook');
      expect(dto.webhookSecret).toBe('super-secret-key');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('leaves undefined webhookUrl and webhookSecret untouched', async () => {
      const dto = toDto({
        notifyOnDelivery: true,
        notifyOnDelay: false,
        notifyOnException: true,
      });
      expect(dto.webhookUrl).toBeUndefined();
      expect(dto.webhookSecret).toBeUndefined();
      expect(await validate(dto)).toHaveLength(0);
    });
  });
});
