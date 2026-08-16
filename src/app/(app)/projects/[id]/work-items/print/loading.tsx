import { Skeleton } from '@/components/ui/skeleton';

/**
 * The AHSP print sheet assembles both analyses of every work item, so it is
 * the slowest page in the project to render — and it is reached by a click
 * that otherwise leaves the previous screen sitting there looking ignored.
 *
 * Shaped like the document rather than as a generic block: a header, then
 * repeating item-and-table pairs, so the wait looks like the thing arriving.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="space-y-2 border-b pb-4">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>

      {Array.from({ length: 2 }, (_, item) => (
        <div key={item} className="space-y-3 border-t pt-6 first:border-t-0 first:pt-0">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-48" />
          {Array.from({ length: 2 }, (_, table) => (
            <div key={table} className="space-y-2 rounded-md border p-3">
              <Skeleton className="h-4 w-32" />
              {Array.from({ length: 4 }, (_, row) => (
                <Skeleton key={row} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
