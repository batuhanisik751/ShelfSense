import { buttonVariants } from '@/components/ui/button';
import { PantryItemCard, type PantryItem } from './PantryItemCard';

export function PantryList({ items }: { items: PantryItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center space-y-3">
        <p className="text-muted-foreground">Your pantry is empty.</p>
        <a href="/receipts/upload" className={buttonVariants()}>
          Upload a receipt
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <PantryItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
