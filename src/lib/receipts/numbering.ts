/**
 * Receipt numbers look like LK-2026-000123: prefix, year (Kenya time), sequence.
 * They are generated in the database by next_receipt_number() so they are
 * unique and gap-free across concurrent payments; this file only describes the
 * format, e.g. for search boxes and validation.
 */
export const RECEIPT_NUMBER_PATTERN = /^([A-Z0-9]{1,6})-(\d{4})-(\d{6,})$/;

export function isReceiptNumber(value: string): boolean {
  return RECEIPT_NUMBER_PATTERN.test(value.trim().toUpperCase());
}

export function parseReceiptNumber(value: string): { prefix: string; year: number; sequence: number } | null {
  const m = RECEIPT_NUMBER_PATTERN.exec(value.trim().toUpperCase());
  return m ? { prefix: m[1], year: Number(m[2]), sequence: Number(m[3]) } : null;
}
