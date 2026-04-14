'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { Loader2, UploadCloud } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { runOcr } from '@/lib/ocr/runOcr';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Stage = 'idle' | 'uploading' | 'ocr' | 'parsing' | 'done' | 'error';

const STAGE_LABEL: Record<Exclude<Stage, 'idle' | 'done' | 'error'>, string> = {
  uploading: 'Uploading receipt…',
  ocr: 'Reading receipt…',
  parsing: 'Extracting items…',
};

type ReceiptUploaderProps = {
  userId: string;
  accessToken: string;
  refreshToken: string;
};

export function ReceiptUploader({ userId, accessToken, refreshToken }: ReceiptUploaderProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .catch((err) => {
        console.error('[receipt-upload] setSession failed:', err);
      });
  }, [supabase, accessToken, refreshToken]);

  const reset = useCallback(() => {
    setStage('idle');
    setErrorMessage(null);
  }, []);

  const fail = useCallback((message: string, detail?: unknown) => {
    console.error('[receipt-upload]', message, detail);
    setStage('error');
    setErrorMessage(message);
    toast.error(message);
  }, []);

  const onDrop = useCallback(
    async (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const code = rejections[0].errors[0]?.code;
        toast.error(
          code === 'file-too-large'
            ? 'Receipt must be under 8 MB.'
            : code === 'file-invalid-type'
              ? 'Upload a PNG, JPG, WEBP, or PDF.'
              : 'That file could not be accepted.',
        );
        return;
      }
      const file = accepted[0];
      if (!file) return;

      setStage('uploading');
      setErrorMessage(null);
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const objectKey = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(objectKey, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        fail('Upload failed. Please try again.', uploadError);
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('receipts')
        .insert({ user_id: userId, file_path: objectKey, status: 'pending' })
        .select('id')
        .single();
      if (insertError || !inserted) {
        fail('Could not save receipt.', insertError);
        return;
      }
      const receiptId = inserted.id;

      setStage('ocr');
      let ocrText: string;
      try {
        ocrText = await runOcr(file);
      } catch (err) {
        await supabase.from('receipts').update({ status: 'failed' }).eq('id', receiptId);
        fail('OCR failed. Please try a clearer photo.', err);
        return;
      }

      const { error: patchError } = await supabase
        .from('receipts')
        .update({ ocr_text: ocrText, status: 'ocr_done' })
        .eq('id', receiptId);
      if (patchError) {
        fail('Could not save OCR text.', patchError);
        return;
      }

      setStage('parsing');
      const res = await fetch('/api/receipts/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        fail('Could not parse receipt.', body);
        return;
      }

      setStage('done');
      toast.success('Receipt processed. Check your pantry.');
    },
    [fail, supabase, userId],
  );

  const isBusy = stage === 'uploading' || stage === 'ocr' || stage === 'parsing';

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/pdf': ['.pdf'],
    },
    maxSize: 8 * 1024 * 1024,
    multiple: false,
    disabled: isBusy,
    noClick: true,
    noKeyboard: true,
    onDrop,
  });

  return (
    <Card>
      <CardContent>
        <div
          {...getRootProps()}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
            isDragActive && 'border-primary bg-primary/5',
            isBusy && 'opacity-70',
          )}
        >
          <input {...getInputProps()} aria-label="Receipt file" />

          {stage === 'idle' || stage === 'done' || stage === 'error' ? (
            <>
              <UploadCloud className="size-8 text-muted-foreground" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {isDragActive ? 'Drop the receipt here' : 'Drop a receipt, or click to choose'}
                </p>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG, WEBP, or PDF — up to 8 MB
                </p>
              </div>
              <Button type="button" onClick={open} variant="secondary">
                Choose file
              </Button>
            </>
          ) : (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-2"
            >
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{STAGE_LABEL[stage]}</p>
            </div>
          )}
        </div>

        {stage === 'done' && (
          <div className="mt-4 flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <p className="text-sm">Receipt processed. Your pantry has been updated.</p>
            <div className="flex gap-2">
              <Link href="/pantry" className={buttonVariants({ size: 'sm' })}>
                View pantry
              </Link>
              <Button variant="outline" size="sm" onClick={reset}>
                Upload another
              </Button>
            </div>
          </div>
        )}

        {stage === 'error' && errorMessage && (
          <div className="mt-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">{errorMessage}</p>
            <Button variant="outline" size="sm" onClick={reset}>
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
