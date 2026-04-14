import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type PantryItem = {
  id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  purchased_at: string;
  estimated_expiration_at: string | null;
  status: 'fresh' | 'use_soon' | 'likely_expired' | 'consumed';
};

export function PantryItemCard({ item }: { item: PantryItem }) {
  const qtyLine = [item.quantity, item.unit].filter(Boolean).join(' ');
  const purchaseDate = format(parseISO(item.purchased_at), 'MMM d, yyyy');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{item.name}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {qtyLine ? `${qtyLine} · ${purchaseDate}` : purchaseDate}
      </CardContent>
    </Card>
  );
}
