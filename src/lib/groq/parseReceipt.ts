import type { ParsedReceiptItem } from '@/lib/validation/schemas';

export async function parseReceipt(_ocrText: string): Promise<ParsedReceiptItem[]> {
  throw new Error('parseReceipt not implemented (Phase 1.3)');
}
