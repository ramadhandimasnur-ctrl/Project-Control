import { Skeleton } from '@/components/ui/skeleton';

/**
 * Placeholders for routes that are still fetching.
 *
 * A skeleton earns its place by having the shape of what replaces it. The
 * project area already had one, but it was card-shaped and served every page
 * beneath it — a table then arrived where a grid of cards had been promised,
 * and the layout jumped. These are shaped like the pages that use them, so the
 * only thing that changes when the data lands is that the grey turns into
 * figures.
 */
export function TableRouteSkeleton({
  columns = 6,
  rows = 8,
  toolbar = true,
}: {
  columns?: number;
  rows?: number;
  toolbar?: boolean;
}) {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      {toolbar ? (
        <div className="flex flex-wrap items-end gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
      ) : null}

      <div className="w-full space-y-px rounded-lg border p-3">
        <div className="flex gap-4 border-b pb-3">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 py-3">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The master-and-detail shape: a list beside an analysis.
 *
 * Mirrors `WorkItemsShell`, including the fact that the analysis column is not
 * drawn at all below `lg` — promising a panel that a phone will never show is
 * worse than promising nothing.
 */
export function SplitRouteSkeleton() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] lg:h-full">
      <aside className="w-full shrink-0 space-y-2 border-r p-3 lg:w-80 lg:p-2">
        <div className="flex items-center justify-between pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg lg:h-12" />
        ))}
      </aside>

      <main className="hidden min-w-0 flex-1 space-y-4 p-6 lg:block">
        <div className="space-y-2 border-b pb-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-72" />
        </div>
        {Array.from({ length: 2 }, (_, s) => (
          <div key={s} className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 4 }, (_, r) => (
              <Skeleton key={r} className="h-8 w-full" />
            ))}
          </div>
        ))}
      </main>
    </div>
  );
}
