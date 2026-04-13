'use client';

import { Button } from '@/components/ui/button';

export function ReceiptUploader() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <p className="text-sm text-muted-foreground">Upload a receipt to populate your pantry.</p>
      <Button type="button" disabled>
        Choose file
      </Button>
    </div>
  );
}
