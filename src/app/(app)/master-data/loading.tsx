import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2 border-b pb-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
