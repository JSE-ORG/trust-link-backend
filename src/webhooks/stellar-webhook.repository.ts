import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Persisted dedupe store for Stellar webhook operations (issue #77).
 *
 * Every processed operation id is written to the `ProcessedWebhookEvent`
 * table so deduplication survives restarts and is shared across replicas.
 * There is deliberately no in-memory fallback: the running application always
 * injects `PrismaService` (PrismaModule is global), so a missing database is a
 * configuration error, not a mode to silently paper over.
 */
@Injectable()
export class StellarWebhookRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Checks whether the webhook operation ID has already been processed.
   *
   * @param operationId Horizon operation identifier.
   * @returns True if already processed.
   */
  async isProcessed(operationId: string): Promise<boolean> {
    const event = await this.prisma.processedWebhookEvent.findUnique({
      where: { operationId },
      select: { operationId: true },
    });
    return event !== null;
  }

  /**
   * Records a webhook operation ID as processed in the database.
   *
   * @param operationId Horizon operation identifier.
   * @returns True if successfully marked, false if conflict occurred.
   */
  async markProcessed(operationId: string): Promise<boolean> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: { operationId },
      });
      return true;
    } catch (error) {
      // The unique operationId constraint is the atomic arbiter when two
      // Horizon deliveries race past isProcessed(). Only that conflict means
      // another request already owns this event; other DB errors must surface.
      if (this.isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Removes a processed webhook operation ID record on processing failure.
   *
   * @param operationId Horizon operation identifier.
   */
  async unmarkProcessed(operationId: string): Promise<void> {
    await this.prisma.processedWebhookEvent.delete({
      where: { operationId },
    });
  }

  /**
   * Deletes processed webhook event rows older than `before` (issue #962).
   * The `@@index([processedAt])` on the model makes this a cheap index scan.
   */
  async pruneOlderThan(before: Date) {
    return this.prisma.processedWebhookEvent.deleteMany({
      where: { processedAt: { lt: before } },
    });
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
