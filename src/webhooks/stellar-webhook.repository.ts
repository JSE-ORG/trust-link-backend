import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StellarWebhookRepository {
  private readonly processedIds = new Set<string>();

  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async isProcessed(operationId: string): Promise<boolean> {
    if (!this.prisma) return this.processedIds.has(operationId);
    const event = await this.prisma.processedWebhookEvent.findUnique({
      where: { operationId },
      select: { operationId: true },
    });
    return event !== null;
  }

  async markProcessed(operationId: string): Promise<void> {
    if (!this.prisma) {
      this.processedIds.add(operationId);
      return;
    }
    await this.prisma.processedWebhookEvent.create({
      data: { operationId },
    });
  }

  async unmarkProcessed(operationId: string): Promise<void> {
    if (!this.prisma) {
      this.processedIds.delete(operationId);
      return;
    }
    await this.prisma.processedWebhookEvent.delete({
      where: { operationId },
    });
  }
}
