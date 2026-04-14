import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAuthBypassed } from '@/lib/auth/bypass';

const PROTECTED_PREFIXES = ['/dashboard', '/pantry', '/receipts', '/meals'];
const AUTH_PATHS = ['/login', '/signup'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthPath = AUTH_PATHS.includes(pathname);

  if (isAuthBypassed()) {
    if (isAuthPath) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/dashboard';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }

    if (pathname.startsWith('/api/dev/session')) {
      return response;
    }

    const hasSupabaseSession = request.cookies
      .getAll()
      .some((c) => {
        if (!c.name.startsWith('sb-')) return false;
        return c.name.endsWith('-auth-token') || /-auth-token\.\d+$/.test(c.name);
      });

    if (!hasSupabaseSession && needsAuth) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/api/dev/session';
      redirectUrl.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (needsAuth) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/login';
      redirectUrl.search = `?error=${encodeURIComponent('Auth is not configured')}`;
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && needsAuth) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = `?redirectTo=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
