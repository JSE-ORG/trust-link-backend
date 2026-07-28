import { Logger } from '@nestjs/common';
import { MailService } from '@sendgrid/mail';
import { Twilio } from 'twilio';
import { ConfigService } from '../config/config.service';
import {
  createSendGridClient,
  createTwilioClient,
} from './notifications.module';

function mockConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('NotificationsModule client factories (issue #394)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('createSendGridClient', () => {
    it('constructs the real SendGrid client when SENDGRID_API_KEY is set', () => {
      const config = mockConfig({ SENDGRID_API_KEY: 'SG.test-api-key' });

      const client = createSendGridClient(config);

      expect(client).toBeInstanceOf(MailService);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns undefined and logs a warning when SENDGRID_API_KEY is unset', () => {
      const config = mockConfig({});

      const client = createSendGridClient(config);

      expect(client).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SENDGRID_API_KEY'),
      );
    });

    it('never logs the API key value', () => {
      const config = mockConfig({ SENDGRID_API_KEY: 'SG.super-secret-key' });

      createSendGridClient(config);
      const client = createSendGridClient(mockConfig({}));
      void client;

      for (const call of warnSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('SG.super-secret-key');
      }
    });
  });

  describe('createTwilioClient', () => {
    it('constructs the real Twilio client when both credentials are set', () => {
      const config = mockConfig({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'test-auth-token',
      });

      const client = createTwilioClient(config);

      expect(client).toBeInstanceOf(Twilio);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns undefined and logs a warning when credentials are unset', () => {
      const config = mockConfig({});

      const client = createTwilioClient(config);

      expect(client).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('TWILIO_ACCOUNT_SID'),
      );
    });

    it('returns undefined and warns when only one of the two credentials is set', () => {
      const config = mockConfig({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      });

      const client = createTwilioClient(config);

      expect(client).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('never logs the auth token value', () => {
      const config = mockConfig({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'super-secret-token',
      });

      createTwilioClient(config);
      createTwilioClient(mockConfig({}));

      for (const call of warnSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('super-secret-token');
      }
    });
  });
});
