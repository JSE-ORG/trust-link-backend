import type { EscrowRecord } from '../prisma/prisma.service';

export const ESCROW_CSV_COLUMNS = [
  'id',
  'itemName',
  'itemRef',
  'amount',
  'currency',
  'state',
  'buyerAddress',
  'createdAt',
  'shippedAt',
  'deliveredAt',
] as const;

/**
 * Formats one CSV cell. A leading `=`, `+`, `-`, `@`, tab or carriage return
 * is prefixed with `'` so spreadsheets treat the value as text, not a formula.
 */
export function csvCell(
  value: string | number | Date | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Renders escrows as CSV with a header row and CRLF line endings. */
export function escrowsToCsv(escrows: EscrowRecord[]): string {
  const rows = escrows.map((escrow) =>
    ESCROW_CSV_COLUMNS.map((column) => csvCell(escrow[column])).join(','),
  );
  return [ESCROW_CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
