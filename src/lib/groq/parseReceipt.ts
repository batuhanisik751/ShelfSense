import Fuse from 'fuse.js';
import { getGroqClient, GROQ_MODEL } from '@/lib/groq/client';
import { parsedReceiptSchema } from '@/lib/validation/schemas';
import type { ParsedReceiptItem } from '@/lib/validation/schemas';

// Hand-authored to mirror parsedReceiptSchema — zod-to-json-schema doesn't support Zod v4 yet.
const RECEIPT_SCHEMA_JSON = JSON.stringify(
  {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'normalized_name', 'category', 'quantity', 'unit'],
          properties: {
            name: { type: 'string', minLength: 1 },
            normalized_name: { type: 'string', minLength: 1 },
            category: { type: 'string', minLength: 1 },
            quantity: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
  null,
  2,
);

const SYSTEM_PROMPT = `You convert raw OCR text from grocery receipts into a JSON array of items.
Output ONLY valid JSON matching the schema below. No prose.
Ignore non-food lines (totals, taxes, store name, addresses, payment info, loyalty points, coupons).
For normalized_name use a lowercase, singular, generic form (e.g. "whole milk", "romaine lettuce").
If a field is unknown, use null for quantity/unit. Never invent items not present in the text.

Schema:
${RECEIPT_SCHEMA_JSON}`;

export async function parseReceipt(
  ocrText: string,
  categoryKeys: string[],
): Promise<ParsedReceiptItem[]> {
  const trimmed = ocrText.trim();
  if (trimmed.length === 0) return [];

  const cappedText = trimmed.slice(0, 8000);

  const client = getGroqClient();

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: cappedText },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 2048,
  });

  if (process.env.NODE_ENV === 'development') {
    const usage = completion.usage;
    if (usage) {
      console.log('[parseReceipt] tokens', {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens,
      });
    }
  }

  const raw: unknown = JSON.parse(
    completion.choices[0]?.message?.content ?? '{}',
  );

  let validated: ReturnType<typeof parsedReceiptSchema.parse>;
  try {
    validated = parsedReceiptSchema.parse(raw);
  } catch (err) {
    console.error('[parseReceipt] validation failed', { raw, err });
    throw err;
  }

  if (categoryKeys.length === 0) return validated.items;

  const fuse = new Fuse(
    categoryKeys.map((k) => ({ key: k })),
    { keys: ['key'], threshold: 0.4, includeScore: false },
  );

  return validated.items.map((item) => {
    const byName = fuse.search(item.normalized_name)[0]?.item.key;
    const byCategory = fuse.search(item.category)[0]?.item.key;
    return { ...item, category: byName ?? byCategory ?? 'other' };
  });
}
