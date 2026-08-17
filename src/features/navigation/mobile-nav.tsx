'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/auth/roles';

import { ProjectSidebar } from '../projects/project-sidebar';

/**
 * The project menu, on a phone.
 *
 * The sidebar is `hidden lg:block`, which on a narrow screen does not mean
 * collapsed — it means gone. Everything inside a project (RAB, RAP, progres,
 * CCO, laporan) was unreachable from the device the site team actually carries.
 *
 * The drawer renders `ProjectSidebar` itself rather than a second copy of the
 * same list. One menu, two containers: a phone that quietly disagreed with the
 * desktop about which modules exist would be worse than no phone menu at all.
 *
 * It lives in the project area rather than the application header because that
 * is where the thing it opens belongs. The header is rendered by a layout that
 * knows nothing about which project is on screen, and wiring the project back
 * up to it would put a button in one place and its meaning in another.
 */
export function ProjectMobileNav({
  projectId,
  code,
  name,
  role,
}: {
  projectId: string;
  code: string;
  name: string;
  role: ProjectRole;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /*
   * Closed on navigation. Left open over the page it just opened, the tap
   * reads as one that did nothing — the new page is already behind the drawer.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/*
        A bar of its own, below the application header and above the page.
        Hidden from `lg` up, where the real sidebar is on screen: two ways to
        the same links, both visible, is how a menu starts disagreeing with
        itself.
      */}
      <div
        data-print="hide"
        className="sticky top-14 z-20 flex items-center gap-3 border-b bg-background px-4 py-2 lg:hidden"
      >
        <DialogPrimitive.Trigger
          aria-label="Buka menu proyek"
          render={<Button variant="outline" size="icon-sm" />}
        >
          <Menu className="size-5" aria-hidden />
        </DialogPrimitive.Trigger>

        {/*
          The project's identity, which on a phone has nowhere else to live —
          the sidebar header that carries it is the very thing that is hidden.
        */}
        <div className="min-w-0">
          <p className="font-mono text-[10px] leading-tight text-muted-foreground">{code}</p>
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
        </div>
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 lg:hidden" />
        <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl outline-none duration-150 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left lg:hidden">
          <div className="flex items-start justify-between gap-2 border-b p-4">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">{code}</p>
              <DialogPrimitive.Title className="mt-0.5 line-clamp-2 text-sm font-semibold">
                {name}
              </DialogPrimitive.Title>
              <Badge variant="secondary" className="mt-2 text-[10px]">
                {PROJECT_ROLE_LABELS[role]}
              </Badge>
            </div>
            <DialogPrimitive.Close
              aria-label="Tutup menu proyek"
              render={<Button variant="ghost" size="icon-sm" className="shrink-0" />}
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {/* The only scrolling region: a long menu must not push the close
              button off a short screen. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProjectSidebar projectId={projectId} role={role} />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
