import { HardHat } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Providers } from '@/components/providers';
import { MobileNavProvider, MobileNavTrigger } from '@/features/navigation/mobile-nav';
import { requireSessionUser } from '@/services/session';

import { UserMenu } from './user-menu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUserOrRedirect();

  /*
   * The same links the header shows, handed to the drawer as data. Writing
   * them twice would let the two lists drift, and the one that drifts is the
   * phone — nobody checks it as often.
   */
  const globalLinks = [
    { href: '/projects', label: 'Proyek' },
    { href: '/master-data/resources', label: 'Master Data' },
    ...(user.globalRole === 'ADMIN' ? [{ href: '/users', label: 'Pengguna' }] : []),
  ];

  return (
    <Providers>
      <MobileNavProvider>
        <div className="flex min-h-screen flex-col">
          <header data-print="hide" className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4 sm:gap-4">
            <MobileNavTrigger globalLinks={globalLinks} />

            <Link href="/projects" className="flex items-center gap-2 font-semibold">
              <span className="flex size-7 items-center justify-center rounded bg-primary text-primary-foreground">
                <HardHat className="size-4" aria-hidden />
              </span>
              <span className="hidden sm:inline">Project Control</span>
            </Link>

            {/*
              Hidden on the narrowest screens, where they crowd the logo and the
              account button off the bar. The drawer carries the same links.
            */}
            <nav aria-label="Navigasi utama" className="hidden items-center gap-1 text-sm sm:flex">
              {globalLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-2 py-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto">
              <UserMenu fullName={user.fullName} email={user.email} globalRole={user.globalRole} />
            </div>
          </header>
          <div className="flex-1">{children}</div>
        </div>
      </MobileNavProvider>
    </Providers>
  );
}

async function getUserOrRedirect() {
  const user = await requireSessionUser().catch(() => null);
  if (!user) redirect('/login');
  return user;
}
