'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { type ProjectRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

import { CURRENT_PHASE, visibleNavSections } from './project-nav';

/**
 * `touch` is the same menu at a size a thumb can hit.
 *
 * A prop rather than a second component: the list of modules must have exactly
 * one definition, or the phone and the desktop will eventually disagree about
 * which modules exist. What legitimately differs between them is density — a
 * mouse lands on a 32px row, a gloved thumb on a site does not — so that is the
 * only thing this switches.
 */
export function ProjectSidebar({
  projectId,
  role,
  size = 'default',
}: {
  projectId: string;
  role: ProjectRole;
  size?: 'default' | 'touch';
}) {
  const pathname = usePathname();
  const sections = visibleNavSections(projectId, role);

  // 44px is the smallest target most accessibility guidance will accept, and
  // `min-h` rather than padding so a wrapped label grows the row instead of
  // bursting out of it.
  const itemSize =
    size === 'touch' ? 'min-h-11 px-3 py-2.5 text-[15px]' : 'px-2 py-1.5 text-sm';

  return (
    <nav
      aria-label="Navigasi proyek"
      className={cn('flex flex-col gap-6', size === 'touch' ? 'p-3' : 'p-4')}
    >
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const ready = item.phase <= CURRENT_PHASE;
              const active = pathname === item.href;

              if (!ready) {
                return (
                  <li key={item.href}>
                    <span
                      className={cn(
                        'flex cursor-not-allowed items-center gap-2 rounded-md text-muted-foreground/60',
                        itemSize,
                      )}
                      title={`Modul ini dikerjakan pada Fase ${item.phase}.`}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                        F{item.phase}
                      </Badge>
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-md transition-colors',
                      itemSize,
                      active
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-foreground/80 hover:bg-accent/60 hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
