import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';

const items = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pantry', label: 'Pantry' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/meals', label: 'Meals' },
];

export async function Nav() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav className="flex items-center justify-between gap-6 border-b px-6 py-4">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-semibold">
          ShelfSense
        </Link>
        <ul className="hidden items-center gap-4 text-sm sm:flex">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-muted-foreground hover:text-foreground">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {user ? (
        <form action={signOut} className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline" title={user.email ?? ''}>
            {user.email}
          </span>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      ) : null}
    </nav>
  );
}
