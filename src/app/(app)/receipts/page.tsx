import { buttonVariants } from '@/components/ui/button';

export default function ReceiptsPage() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <a href="/receipts/upload" className={buttonVariants()}>
          Upload receipt
        </a>
      </div>
      <p className="text-muted-foreground">No receipts yet.</p>
    </section>
  );
}
