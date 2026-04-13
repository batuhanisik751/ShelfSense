import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function ReceiptsPage() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <Link href="/receipts/upload" className={buttonVariants()}>
          Upload receipt
        </Link>
      </div>
      <p className="text-muted-foreground">No receipts yet.</p>
    </section>
  );
}
