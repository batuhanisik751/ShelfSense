import Link from 'next/link';

const items = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pantry', label: 'Pantry' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/meals', label: 'Meals' },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-6 border-b px-6 py-4">
      <Link href="/dashboard" className="font-semibold">
        ShelfSense
      </Link>
      <ul className="flex items-center gap-4 text-sm">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="text-muted-foreground hover:text-foreground">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
