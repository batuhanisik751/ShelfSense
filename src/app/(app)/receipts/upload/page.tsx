import { ReceiptUploader } from '@/components/receipts/ReceiptUploader';

export default function ReceiptUploadPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Upload receipt</h1>
      <ReceiptUploader />
    </section>
  );
}
