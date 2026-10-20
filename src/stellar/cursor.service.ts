import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Manages per-consumer cursor state for chain sync (issue #1048).
 *
 * Each consumer (poller, indexer, etc.) has its own cursor key so they
 * can advance independently without interfering with each other.
 */
@Injectable()
export class CursorService {
  private readonly logger = new Logger(CursorService.name);
  private readonly dataDir = path.resolve(process.cwd(), 'data');

  /**
   * Get the cursor for a consumer. Returns undefined if not set.
   */
  async getCursor(consumer: string): Promise<string | undefined> {
    const file = this.cursorFile(consumer);
    if (!fs.existsSync(file)) return undefined;
    const value = fs.readFileSync(file, 'utf8').trim();
    return value || undefined;
  }

  /**
   * Advance the cursor for a consumer. No-op if the new token is empty
   * (e.g., empty page).
   */
  async advanceCursor(consumer: string, token: string): Promise<void> {
    if (!token) {
      this.logger.debug(`Empty cursor token for ${consumer}, skipping advance`);
      return;
    }
    const file = this.cursorFile(consumer);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, token);
    this.logger.debug(`Advanced ${consumer} cursor to ${token}`);
  }

  /**
   * Reset a consumer's cursor (for testing or recovery).
   */
  async resetCursor(consumer: string): Promise<void> {
    const file = this.cursorFile(consumer);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    this.logger.log(`Reset ${consumer} cursor`);
  }

  private cursorFile(consumer: string): string {
    return path.join(this.dataDir, `stellar_cursor_${consumer}.txt`);
  }
}
