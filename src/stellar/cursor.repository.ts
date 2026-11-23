import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CursorRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a saved blockchain ledger cursor by id.
   *
   * @param id Cursor identifier.
   * @returns Cursor record or null if not found.
   */
  findById(id: string) {
    return this.prisma.cursor.findUnique({ where: { id } });
  }

  /**
   * Updates or inserts a blockchain ledger cursor position.
   *
   * @param id Cursor identifier.
   * @param cursorValue Cursor ledger string.
   */
  async upsert(id: string, cursorValue: string): Promise<void> {
    await this.prisma.cursor.upsert({
      where: { id },
      update: { cursorValue },
      create: { id, cursorValue },
    });
  }
}
