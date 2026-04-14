import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAuthBypassed } from '@/lib/auth/bypass';

export default async function Home() {
  if (isAuthBypassed()) {
    redirect('/dashboard');
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? '/dashboard' : '/login');
}
