/**
 * Exercises the @Transform functions on UpdateNotificationPreferencesDto
 * (issue #1228): channels are upper-cased before @IsEnum runs, and the
 * webhook URL and secret are trimmed.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateNotificationPreferencesDto } from './update-notification-preferences.dto';

function toDto(
  plain: Record<string, unknown>,
): UpdateNotificationPreferencesDto {
  return plainToInstance(UpdateNotificationPreferencesDto, plain);
}

describe('UpdateNotificationPreferencesDto transforms (#1228)', () => {
  describe('notificationChannels', () => {
    it("upper-cases ['email'] to ['EMAIL'] and then validates", async () => {
      const dto = toDto({ notificationChannels: ['email'] });

      expect(dto.notificationChannels).toEqual(['EMAIL']);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('upper-cases mixed-case channels', async () => {
      const dto = toDto({ notificationChannels: ['Email', 'sMs'] });

      expect(dto.notificationChannels).toEqual(['EMAIL', 'SMS']);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('still rejects an unknown channel after upper-casing', async () => {
      const dto = toDto({ notificationChannels: ['push'] });

      expect(dto.notificationChannels).toEqual(['PUSH']);
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toEqual(['notificationChannels']);
    });

    it('passes a non-array through unchanged so @IsArray rejects it', async () => {
      const dto = toDto({ notificationChannels: 'email' });

      expect(dto.notificationChannels).toBe('email');
      const errors = await validate(dto);
      expect(errors[0].constraints).toHaveProperty('isArray');
    });
  });

  describe('webhookUrl and webhookSecret', () => {
    it('trims surrounding whitespace from both', async () => {
      const dto = toDto({
        webhookUrl: '  https://example.com/webhook  ',
        webhookSecret: '\twhsec_abc123\n',
      });

      expect(dto.webhookUrl).toBe('https://example.com/webhook');
      expect(dto.webhookSecret).toBe('whsec_abc123');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('leaves omitted fields undefined', async () => {
      const dto = toDto({ notifyOnDelivery: true });

      expect(dto.webhookUrl).toBeUndefined();
      expect(dto.webhookSecret).toBeUndefined();
      expect(await validate(dto)).toHaveLength(0);
    });
  });
});
