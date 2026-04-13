import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{item.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {item.quantity ?? ''} {item.unit ?? ''}
        </span>
        {item.category ? <Badge variant="secondary">{item.category}</Badge> : null}
      </CardContent>
    </Card>
  );
}
