import { PantryList } from '@/components/pantry/PantryList';

export default function PantryPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Pantry</h1>
      <PantryList items={[]} />
    </section>
  );
}
