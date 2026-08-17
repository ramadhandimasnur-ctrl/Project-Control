'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

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
        {/*
          A full 44px square. `icon-sm` is 32px, which is comfortable under a
          mouse and a genuine miss under a thumb — and this is the one control
          standing between a phone and every page in the project.
        */}
        <DialogPrimitive.Trigger
          aria-label="Buka menu proyek"
          render={<Button variant="outline" size="icon" className="size-11 shrink-0" />}
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
        {/*
          Tapping the dark area closes the drawer — Base UI's backdrop does that
          for us. The blur is what separates the two planes: without it a menu
          over a dense table reads as part of the table.
        */}
        <DialogPrimitive.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black/50 lg:hidden',
            'supports-backdrop-filter:backdrop-blur-sm',
            'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            'data-open:animate-in data-open:fade-in-0',
            'data-closed:animate-out data-closed:fade-out-0 data-closed:duration-200',
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            // 82% of the viewport at the narrowest, so the page behind stays
            // visible: a panel that covers everything is a new screen, and the
            // reader loses track of what they were looking at.
            'fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-80 flex-col bg-background shadow-2xl outline-none lg:hidden',
            /*
             * A drawer that eases out fast and settles slowly reads as a
             * physical panel; the linear 150ms it had before read as a jump.
             * The curve is the one used for sheets on iOS — most of the travel
             * happens early, then it decelerates into place. Closing is quicker
             * than opening, because a dismissal that lingers feels unresponsive.
             */
            'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            'data-open:animate-in data-open:slide-in-from-left',
            'data-closed:animate-out data-closed:slide-out-to-left data-closed:duration-200',
          )}
        >
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
              render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {/*
            The only scrolling region, and it keeps its scrolling to itself.
            `overscroll-contain` is the load-bearing part: without it, flicking
            past the end of the menu hands the gesture to the page underneath,
            which then scrolls behind the drawer — the reader closes the menu
            and finds themselves somewhere they never navigated to.
          */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            <ProjectSidebar projectId={projectId} role={role} size="touch" />
            {/* Breathing room past the last item, clear of a phone's home bar. */}
            <div className="h-[env(safe-area-inset-bottom)] min-h-4" />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
