import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CursorRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.cursor.findUnique({ where: { id } });
  }

  async upsert(id: string, cursorValue: string): Promise<void> {
    await this.prisma.cursor.upsert({
      where: { id },
      update: { cursorValue },
      create: { id, cursorValue },
    });
  }
}
