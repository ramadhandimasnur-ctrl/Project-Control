'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Master and detail, arranged differently for the screen it is on.
 *
 * On a wide screen the two panels sit side by side, which is right: an
 * estimator scrolls the breakdown with one eye on the analysis. Forced into a
 * phone that same layout gives the list 40% of a 390px screen and the analysis
 * the rest, and both become unreadable — the complaint that produced this.
 *
 * So the phone gets one thing at a time: the list fills the screen, and the
 * analysis arrives as a sheet from the bottom. Which is showing is decided by
 * the URL, not by state held here — the server renders the analysis for
 * `?item=`, and this component only chooses how to present what it is handed.
 * That keeps one source of truth for "which item", so a link shared from a
 * phone opens the same thing on a desktop.
 */
export function WorkItemsShell({
  list,
  detail,
  detailOpen,
  detailTitle,
  closeHref,
}: {
  list: ReactNode;
  detail: ReactNode;
  /** True when the URL names an item, rather than the page defaulting to one. */
  detailOpen: boolean;
  detailTitle: string;
  closeHref: string;
}) {
  const router = useRouter();

  return (
    /*
      Fixed height from `lg`, not merely a minimum.

      The list column was written to scroll on its own — its `nav` carries
      `flex-1 overflow-y-auto` — but with only a `min-height` the row grows to
      whatever the analysis needs, so neither column ever scrolls and the whole
      page does instead. On a long analysis that drags the table's own
      horizontal scrollbar to the bottom of a very tall page, which is where it
      was found: unreachable without scrolling past everything.

      Phones keep the page scroll. Trapping a thumb inside a column is worse
      than a long page, and the analysis is a sheet there anyway.
    */
    <div className="flex min-h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] lg:min-h-0 lg:overflow-hidden">
      {/*
        Full width on a phone, a fixed column beside the analysis from `lg`.
      */}
      <aside className="flex w-full shrink-0 flex-col border-r lg:w-80 lg:overflow-hidden">
        {list}
      </aside>

      {/* Scrolls on its own, so the analysis stays beside the list it belongs to. */}
      <main className="hidden min-w-0 flex-1 p-6 lg:block lg:overflow-auto lg:overscroll-contain">
        {detail}
      </main>

      {/*
        The same analysis, as a sheet. Rendered only when an item is named, so
        arriving at the page does not open a panel nobody asked for.
      */}
      <DialogPrimitive.Root
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) router.push(closeHref, { scroll: false });
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-200 lg:hidden" />
          <DialogPrimitive.Popup
            className={[
              // Nearly full height, but not all of it: the strip of page left
              // showing is what tells the reader this is a layer over the list
              // rather than a screen they navigated to.
              'fixed inset-x-0 bottom-0 z-50 flex h-[92vh] flex-col rounded-t-2xl bg-background shadow-2xl outline-none lg:hidden',
              'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              'data-open:animate-in data-open:slide-in-from-bottom',
              'data-closed:animate-out data-closed:slide-out-to-bottom data-closed:duration-200',
            ].join(' ')}
          >
            {/* The grabber. Purely a signal that this panel came from the
                bottom edge and goes back there. */}
            <div className="flex justify-center pt-2" aria-hidden>
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">
                {detailTitle}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Tutup analisa"
                render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
              >
                <X className="size-5" aria-hidden />
              </DialogPrimitive.Close>
            </div>

            {/*
              Scrolls on its own. `overscroll-contain` stops a flick past the
              end from scrolling the list behind the sheet, which would leave
              the reader somewhere else when they close it.
            */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {detail}
              <div className="h-[env(safe-area-inset-bottom)] min-h-6" />
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
