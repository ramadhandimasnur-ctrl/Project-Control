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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4">
          <Link href="/projects" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded bg-primary text-primary-foreground">
              <HardHat className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">Project Control</span>
          </Link>
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
