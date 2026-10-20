import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService SMS sender (#838)', () => {
  it('passes the configured Twilio sender on the message request', async () => {
    const twilio = {
      messages: { create: jest.fn().mockResolvedValue({ sid: 'SM123' }) },
    };
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) =>
        key === 'TWILIO_FROM_NUMBER' ? '+15551234567' : undefined,
      ),
    } as unknown as ConfigService;
    const service = new NotificationsService(
      prisma,
      { send: jest.fn().mockResolvedValue(undefined) },
      twilio,
      config,
    );
    const escrow = {
      id: 'escrow-1',
      itemName: 'Widget',
      vendorAddress: '+15557654321',
      buyerAddress: '+15557654322',
    } as Parameters<NotificationsService['notifyFunded']>[0];

    await service.notifyFunded(escrow);

    expect(twilio.messages.create).toHaveBeenCalledWith({
      to: escrow.vendorAddress,
      body: 'FUNDED: Widget',
      from: '+15551234567',
    });
  });
});
