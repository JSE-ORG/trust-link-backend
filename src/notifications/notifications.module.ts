import { Logger, Module } from '@nestjs/common';
import { MailService } from '@sendgrid/mail';
import twilio from 'twilio';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { NotificationsService } from './notifications.service';
import { SENDGRID_CLIENT, TWILIO_CLIENT } from './notifications.tokens';

const logger = new Logger('NotificationsModule');

/**
 * Constructs the real SendGrid client when SENDGRID_API_KEY is configured,
 * otherwise logs a startup warning and returns undefined so NotificationsService
 * falls back to its built-in no-op client.
 */
export function createSendGridClient(config: ConfigService) {
  const apiKey = config.get('SENDGRID_API_KEY');
  if (!apiKey) {
    logger.warn(
      'SENDGRID_API_KEY is not set — email notifications are disabled (using no-op client)',
    );
    return undefined;
  }
  const client = new MailService();
  client.setApiKey(apiKey);
  return client;
}

/**
 * Constructs the real Twilio client when both TWILIO_ACCOUNT_SID and
 * TWILIO_AUTH_TOKEN are configured, otherwise logs a startup warning and
 * returns undefined so NotificationsService falls back to its no-op client.
 */
export function createTwilioClient(config: ConfigService) {
  const accountSid = config.get('TWILIO_ACCOUNT_SID');
  const authToken = config.get('TWILIO_AUTH_TOKEN');
  if (!accountSid || !authToken) {
    logger.warn(
      'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not set — SMS notifications are disabled (using no-op client)',
    );
    return undefined;
  }
  return twilio(accountSid, authToken);
}

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [
    NotificationsService,
    {
      provide: SENDGRID_CLIENT,
      inject: [ConfigService],
      useFactory: createSendGridClient,
    },
    {
      provide: TWILIO_CLIENT,
      inject: [ConfigService],
      useFactory: createTwilioClient,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
