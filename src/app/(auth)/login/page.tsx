import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendMagicLink } from '../actions';
import { SubmitButton } from '../SubmitButton';

type SearchParams = {
  error?: string;
  sent?: string;
  email?: string;
  redirectTo?: string;
};

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sent = searchParams.sent === '1';
  const redirectTo = searchParams.redirectTo ?? '/dashboard';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll email you a magic link — no password needed.
        </p>
      </div>

      {sent ? (
        <div
          className="rounded-md border bg-muted p-4 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          Check <strong>{searchParams.email}</strong> for the sign-in link.
        </div>
      ) : (
        <form action={sendMagicLink} className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="returnPath" value="/login" />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              aria-describedby={searchParams.error ? 'login-error' : undefined}
            />
          </div>
          {searchParams.error ? (
            <p id="login-error" className="text-sm text-destructive" role="alert">
              {searchParams.error}
            </p>
          ) : null}
          <SubmitButton label="Send magic link" />
        </form>
      )}

      <p className="text-sm text-muted-foreground">
        New to ShelfSense?{' '}
        <Link href="/signup" className="text-foreground underline">
          Create an account
        </Link>
      </p>
    </main>
  );
}
