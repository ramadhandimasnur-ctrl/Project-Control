import { Skeleton } from '@/components/ui/skeleton';

/**
 * The CCO sheet compares Baseline 0 against the current scope item by item,
 * which means the whole estimate plus the frozen copy of it. Same reasoning as
 * the AHSP sheet: the click that opens it deserves an answer before the data
 * arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="space-y-2 border-b pb-4">
        <Skeleton className="h-6 w-80" />
        <Skeleton className="h-4 w-64" />
      </div>

      {Array.from({ length: 2 }, (_, section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-5 w-72" />
          <div className="space-y-2 rounded-md border p-3">
            {Array.from({ length: 6 }, (_, row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}

      <div className="grid gap-8 pt-8 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, slot) => (
          <Skeleton key={slot} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
