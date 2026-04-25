import Link from 'next/link';
import { logout } from '@/lib/session';
import { redirect } from 'next/navigation';

async function handleLogout(): Promise<void> {
  'use server';
  await logout();
  redirect('/login');
}

export function Nav(): React.ReactElement {
  return (
    <nav className="bg-ogun-surface border-b border-ogun-border">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="text-ogun-accent font-bold text-lg no-underline">
          Ogun
        </Link>
        <NavLink href="/compliance">Compliance</NavLink>
        <NavLink href="/wallets">Wallets</NavLink>
        <NavLink href="/admin/collections">Collections</NavLink>
        <NavLink href="/admin/payouts">Payouts</NavLink>
        <NavLink href="/admin/settlements">Settlements</NavLink>
        <div className="ml-auto">
          <form action={handleLogout}>
            <button type="submit" className="text-ogun-muted text-sm hover:text-ogun-text">
              Log out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Link href={href} className="text-sm text-ogun-text no-underline hover:text-ogun-accent">
      {children}
    </Link>
  );
}
