import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatCategoryLabel } from '@/lib/pantry/categoryLabels';
import { PantryList } from '@/components/pantry/PantryList';
import type { PantryItem } from '@/components/pantry/PantryItemCard';

export default async function PantryPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/pantry');
  }

  const { data, error } = await supabase
    .from('pantry_items')
    .select('id, name, category, quantity, unit, purchased_at, estimated_expiration_at, status')
    .order('category', { ascending: true, nullsFirst: false })
    .order('purchased_at', { ascending: false });

  if (error) throw error;

  const items = (data ?? []) as PantryItem[];

  if (items.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Pantry</h1>
        <PantryList items={[]} />
      </section>
    );
  }

  const groupMap = new Map<string, PantryItem[]>();
  for (const item of items) {
    const key = item.category ?? 'other';
    const existing = groupMap.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groupMap.set(key, [item]);
    }
  }

  const groups = Array.from(groupMap.entries())
    .map(([category, groupItems]) => ({
      category,
      label: formatCategoryLabel(category),
      items: groupItems,
    }))
    .sort((a, b) => {
      if (a.label === 'Other') return 1;
      if (b.label === 'Other') return -1;
      return a.label.localeCompare(b.label);
    });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Pantry</h1>
      {groups.map((group) => (
        <div key={group.category} className="space-y-2">
          <h2 className="text-lg font-semibold">{group.label}</h2>
          <PantryList items={group.items} />
        </div>
      ))}
    </section>
  );
}
