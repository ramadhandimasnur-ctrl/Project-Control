'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

import { CURRENT_PHASE, visibleNavSections } from '../projects/project-nav';

/**
 * Navigation for a phone.
 *
 * The project sidebar was `hidden lg:block`, which on a phone did not mean
 * "collapsed" — it meant gone. Everything inside a project (RAB, progres, CCO,
 * laporan) was unreachable from the device the site team actually carries.
 *
 * One drawer rather than two. The header knows the application-wide links; the
 * project layout knows which project it is showing and what the reader's role
 * is. Rather than giving each a hamburger of its own, the project registers
 * itself here and the single button in the header opens whichever of the two
 * is relevant.
 */

type ProjectContext = {
  id: string;
  code: string;
  name: string;
  role: ProjectRole;
};

type MobileNavValue = {
  project: ProjectContext | null;
  setProject: (project: ProjectContext | null) => void;
};

const MobileNavContext = createContext<MobileNavValue | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<ProjectContext | null>(null);
  const value = useMemo(() => ({ project, setProject }), [project]);

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

function useMobileNav(): MobileNavValue {
  const context = useContext(MobileNavContext);
  if (!context) {
    throw new Error('MobileNavProvider belum dipasang di atas komponen ini.');
  }
  return context;
}

/**
 * Announces the current project to the header's drawer.
 *
 * Renders nothing. The project layout is a server component and cannot hand
 * data sideways to the header, so this sits inside it and posts the details
 * into context on mount — and clears them on unmount, so leaving the project
 * does not leave its menu behind.
 */
export function ProjectNavRegistrar(project: ProjectContext) {
  const { setProject } = useMobileNav();
  const { id, code, name, role } = project;

  useEffect(() => {
    setProject({ id, code, name, role });
    return () => setProject(null);
  }, [setProject, id, code, name, role]);

  return null;
}

type GlobalLink = { href: string; label: string };

export function MobileNavTrigger({ globalLinks }: { globalLinks: GlobalLink[] }) {
  const { project } = useMobileNav();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /*
   * Closed on navigation. Without this the drawer stays over the page it just
   * opened, and on a phone that reads as a tap that did nothing.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = useCallback(() => setOpen(false), []);
  const sections = project ? visibleNavSections(project.id, project.role) : [];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/*
        Hidden from `lg` up, where the real sidebar is on screen. Two ways to
        reach the same links, both visible at once, is how a menu starts
        disagreeing with itself.
      */}
      <DialogPrimitive.Trigger
        aria-label="Buka menu navigasi"
        render={<Button variant="ghost" size="icon-sm" className="lg:hidden" />}
      >
        <Menu className="size-5" aria-hidden />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 lg:hidden" />
        <DialogPrimitive.Popup
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl outline-none',
            'duration-150 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left',
            'lg:hidden',
          )}
        >
          <div className="flex items-center justify-between border-b p-4">
            <DialogPrimitive.Title className="text-sm font-semibold">
              Navigasi
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Tutup menu navigasi"
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {/* The only scrolling region: a long project menu must not push the
              close button off a short screen. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {project ? (
              <div className="border-b p-4">
                <p className="font-mono text-xs text-muted-foreground">{project.code}</p>
                <p className="mt-0.5 line-clamp-2 text-sm font-semibold">{project.name}</p>
                <Badge variant="secondary" className="mt-2 text-[10px]">
                  {PROJECT_ROLE_LABELS[project.role]}
                </Badge>
              </div>
            ) : null}

            {sections.length > 0 ? (
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
                              <span className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground/60">
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
                              onClick={close}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                // Roomier than the desktop sidebar: this one is
                                // tapped with a thumb, often with gloves on.
                                'flex items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors',
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
            ) : null}

            <nav aria-label="Navigasi utama" className="border-t p-4">
              <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Aplikasi
              </p>
              <ul className="space-y-0.5">
                {globalLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={close}
                      className="flex items-center gap-2 rounded-md px-2 py-2.5 text-sm text-foreground/80 transition-colors hover:bg-accent/60 hover:text-accent-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
