import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { isAuthBypassed } from '@/lib/auth/bypass';
import { DEV_USER_EMAIL, DEV_USER_PASSWORD } from '@/lib/auth/devUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export async function GET(request: NextRequest) {
  if (!isAuthBypassed()) {
    return NextResponse.json(
      { error: 'Dev session only available when AUTH_BYPASS=1 and NODE_ENV !== production' },
      { status: 404 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          'Missing env vars. Dev auto-login needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.',
      },
      { status: 500 },
    );
  }

  const admin = createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: DEV_USER_EMAIL,
    password: DEV_USER_PASSWORD,
    email_confirm: true,
  });

  if (createError && !/already|exists|registered/i.test(createError.message)) {
    console.error('[dev-session] createUser failed:', createError);
    return NextResponse.json(
      { error: `Could not create dev user: ${createError.message}` },
      { status: 500 },
    );
  }

  if (created?.user && !created.user.email_confirmed_at) {
    await admin.auth.admin.updateUserById(created.user.id, { email_confirm: true });
  }

  const cookieStore = cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: '', ...options });
      },
    },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: DEV_USER_EMAIL,
    password: DEV_USER_PASSWORD,
  });

  if (signInError) {
    console.error('[dev-session] signInWithPassword failed:', signInError);
    return NextResponse.json(
      { error: `Could not sign in dev user: ${signInError.message}` },
      { status: 500 },
    );
  }

  const next = safeNext(request.nextUrl.searchParams.get('next'));
  return NextResponse.redirect(new URL(next, request.nextUrl.origin));
}
