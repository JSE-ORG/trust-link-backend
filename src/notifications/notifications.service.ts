import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  EscrowRecord,
  NotificationType,
  PrismaService,
} from '../prisma/prisma.service';
import { SENDGRID_CLIENT, TWILIO_CLIENT } from './notifications.tokens';

interface SendGridClient {
  send(message: Record<string, unknown>): Promise<unknown>;
}

interface TwilioClient {
  messages: {
    create(message: Record<string, unknown>): Promise<{ sid?: string }>;
  };
}

const noopSendGrid: SendGridClient = {
  send: () => Promise.resolve(undefined),
};
const noopTwilio: TwilioClient = {
  messages: { create: () => Promise.resolve({ sid: undefined }) },
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(SENDGRID_CLIENT)
    private readonly sendGrid: SendGridClient = noopSendGrid,
    @Optional()
    @Inject(TWILIO_CLIENT)
    private readonly twilio: TwilioClient = noopTwilio,
  ) {}

  notifyFunded(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('FUNDED', escrow, escrow.vendorAddress);
  }

  notifyShipped(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('SHIPPED', escrow, escrow.buyerAddress);
  }

  notifyDelivered(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('DELIVERED', escrow, escrow.buyerAddress);
  }

  notifyDisputed(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('DISPUTED', escrow, escrow.vendorAddress);
  }

  notifyCompleted(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('COMPLETED', escrow, escrow.buyerAddress);
  }

  notifyRefunded(escrow: EscrowRecord): Promise<void> {
    return this.dispatch('REFUNDED', escrow, escrow.buyerAddress);
  }

  private async dispatch(
    type: NotificationType,
    escrow: EscrowRecord,
    recipientAddress: string,
  ): Promise<void> {
    await this.dispatchEmail(type, escrow, recipientAddress);
    await this.dispatchSms(type, escrow, recipientAddress);
  }

  private async dispatchEmail(
    type: 'FUNDED' | 'SHIPPED',
    escrow: EscrowRecord,
    recipientAddress: string,
  ): Promise<void> {
    let providerMessageId: string | null = null;
    try {
      const response = await this.sendGrid.send({
        to: recipientAddress,
        templateId: `trustlink-${type.toLowerCase()}`,
        dynamicTemplateData: { escrowId: escrow.id, itemName: escrow.itemName },
      });
      providerMessageId = this.extractProviderId(response);
    } catch (error) {
      this.logger.error(`SendGrid ${type} notification failed`, error);
    }

    await this.prisma.notification.create({
      data: {
        escrowId: escrow.id,
        type,
        channel: 'EMAIL',
        recipientAddress,
        providerMessageId,
      },
    });
  }

  private async dispatchSms(
    type: 'FUNDED' | 'SHIPPED',
    escrow: EscrowRecord,
    recipientAddress: string,
  ): Promise<void> {
    let providerMessageId: string | null = null;
    try {
      const response = await this.twilio.messages.create({
        to: recipientAddress,
        body: `${type}: ${escrow.itemName}`,
      });
      providerMessageId = response.sid ?? null;
    } catch (error) {
      this.logger.error(`Twilio ${type} notification failed`, error);
    }

    await this.prisma.notification.create({
      data: {
        escrowId: escrow.id,
        type,
        channel: 'SMS',
        recipientAddress,
        providerMessageId,
      },
    });
  }

  private extractProviderId(response: unknown): string | null {
    if (
      Array.isArray(response) &&
      typeof response[0] === 'object' &&
      response[0] !== null &&
      'headers' in response[0]
    ) {
      const headers = (response[0] as { headers?: Record<string, string> })
        .headers;
      return headers?.['x-message-id'] ?? null;
    }
    return null;
  }
}
