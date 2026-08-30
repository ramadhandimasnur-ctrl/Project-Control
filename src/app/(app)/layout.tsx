import { HardHat } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Providers } from '@/components/providers';
import { requireSessionUser } from '@/services/session';

import { UserMenu } from './user-menu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUserOrRedirect();

  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <header data-print="hide" className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4">
          <Link href="/projects" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded bg-primary text-primary-foreground">
              <HardHat className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">Project Control</span>
          </Link>

          <nav aria-label="Navigasi utama" className="flex items-center gap-1 text-sm">
            <Link
              href="/projects"
              className="rounded-md px-2 py-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Proyek
            </Link>
            <Link
              href="/master-data/resources"
              className="rounded-md px-2 py-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Master Data
            </Link>
            {/*
              Shown to administrators only. The page enforces this for itself —
              this merely avoids offering a link that answers with a refusal.
            */}
            {/*
              Last in the row, and always present. A guide that only appears
              for administrators is a guide the people with the most questions
              cannot reach.
            */}
            <Link
              href="/help"
              className="rounded-md px-2 py-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Petunjuk
            </Link>
            {user.globalRole === 'ADMIN' ? (
              <Link
                href="/users"
                className="rounded-md px-2 py-1.5 text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Pengguna
              </Link>
            ) : null}
          </nav>

          <div className="ml-auto">
            <UserMenu fullName={user.fullName} email={user.email} globalRole={user.globalRole} />
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </Providers>
  );
}

async function getUserOrRedirect() {
  const user = await requireSessionUser().catch(() => null);
  if (!user) redirect('/login');
  return user;
}
