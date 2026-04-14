import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { parseReceipt } from '@/lib/groq/parseReceipt';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  receiptId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const { receiptId } = parsedBody.data;

  const { data: receipt, error: receiptError } = await supabase
    .from('receipts')
    .select('id, user_id, ocr_text, uploaded_at, status')
    .eq('id', receiptId)
    .single();

  if (receiptError || !receipt) {
    return NextResponse.json({ ok: false, error: 'receipt_not_found' }, { status: 404 });
  }

  const ocrText = receipt.ocr_text ?? '';

  const { data: rules, error: rulesError } = await supabase
    .from('shelf_life_rules')
    .select('category');

  if (rulesError) {
    console.error('[api/receipts/parse] failed to load shelf_life_rules', rulesError);
    return NextResponse.json({ ok: false, error: 'rules_unavailable' }, { status: 500 });
  }

  const categoryKeys = (rules ?? []).map((r) => r.category);

  let items: Awaited<ReturnType<typeof parseReceipt>>;
  try {
    items = await parseReceipt(ocrText, categoryKeys);
  } catch (err) {
    console.error('[api/receipts/parse] parseReceipt failed', err);
    await supabase.from('receipts').update({ status: 'failed' }).eq('id', receiptId);
    return NextResponse.json({ ok: false, error: 'parse_failed' }, { status: 502 });
  }

  const purchasedAt = new Date(receipt.uploaded_at).toISOString().slice(0, 10);

  if (items.length > 0) {
    const rows = items.map((item) => ({
      user_id: userData.user!.id,
      receipt_id: receipt.id,
      name: item.name,
      normalized_name: item.normalized_name,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      purchased_at: purchasedAt,
      estimated_expiration_at: null,
      status: 'fresh' as const,
    }));

    const { error: insertError } = await supabase.from('pantry_items').insert(rows);
    if (insertError) {
      console.error('[api/receipts/parse] pantry insert failed', insertError);
      await supabase.from('receipts').update({ status: 'failed' }).eq('id', receiptId);
      return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
    }
  }

  const { error: statusError } = await supabase
    .from('receipts')
    .update({ status: 'parsed' })
    .eq('id', receiptId);

  if (statusError) {
    console.error('[api/receipts/parse] status update failed', statusError);
  }

  return NextResponse.json({ ok: true, count: items.length });
}
