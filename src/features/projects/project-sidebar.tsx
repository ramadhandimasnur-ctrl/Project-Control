'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { type ProjectRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

import { CURRENT_PHASE, visibleNavSections } from './project-nav';

export function ProjectSidebar({
  projectId,
  role,
}: {
  projectId: string;
  role: ProjectRole;
}) {
  const pathname = usePathname();
  const sections = visibleNavSections(projectId, role);

  return (
    <nav aria-label="Navigasi proyek" className="flex flex-col gap-6 p-4">
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
                      className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60"
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
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
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
