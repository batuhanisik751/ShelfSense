'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

function getOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const h = headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${proto}://${host}`;
}

function safeInternalPath(raw: FormDataEntryValue | null, fallback: string) {
  const value = typeof raw === 'string' ? raw : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const next = safeInternalPath(formData.get('redirectTo'), '/dashboard');
  const returnPath = safeInternalPath(formData.get('returnPath'), '/login');

  if (!email) {
    redirect(`${returnPath}?error=${encodeURIComponent('Email is required')}`);
  }

  let errorMessage: string | null = null;
  try {
    const supabase = createClient();
    const origin = getOrigin();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      console.error('[auth] signInWithOtp failed:', {
        name: error.name,
        status: (error as { status?: number }).status,
        message: error.message,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      });
      errorMessage = /not valid JSON|Unexpected token|<!DOCTYPE/i.test(error.message)
        ? 'Auth server returned an unexpected response. Check that NEXT_PUBLIC_SUPABASE_URL is correct (https://<project>.supabase.co), NEXT_PUBLIC_SUPABASE_ANON_KEY matches that project, and the project is not paused.'
        : error.message;
    }
  } catch (e) {
    console.error('[auth] sendMagicLink threw:', e);
    errorMessage = e instanceof Error ? e.message : 'Unexpected error sending magic link.';
  }

  if (errorMessage) {
    redirect(`${returnPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  redirect(`${returnPath}?sent=1&email=${encodeURIComponent(email)}`);
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
