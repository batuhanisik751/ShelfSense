import { PantryItemCard, type PantryItem } from './PantryItemCard';

export function PantryList({ items }: { items: PantryItem[] }) {
  if (items.length === 0) {
    return <p className="text-muted-foreground">Your pantry is empty.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <PantryItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
