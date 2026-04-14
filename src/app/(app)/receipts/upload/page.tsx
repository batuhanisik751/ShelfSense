import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAuthBypassed } from '@/lib/auth/bypass';
import { ReceiptUploader } from '@/components/receipts/ReceiptUploader';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ReceiptUploadPage() {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: sessionData } = await supabase.auth.getSession();

  if (!userData.user || !sessionData.session) {
    const target = isAuthBypassed()
      ? '/api/dev/session?next=/receipts/upload'
      : '/login?redirectTo=/receipts/upload';
    redirect(target);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Upload receipt</h1>
      <ReceiptUploader
        userId={userData.user.id}
        accessToken={sessionData.session.access_token}
        refreshToken={sessionData.session.refresh_token}
      />
    </section>
  );
}
