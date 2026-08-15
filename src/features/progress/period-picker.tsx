'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import { cn } from '@/lib/utils';

/**
 * Chooses which period a page is showing.
 *
 * Navigates rather than holding local state so the choice survives a reload
 * and can be shared as a link — a report someone is asked to check should open
 * on the period they were told about.
 */
export function PeriodPicker({
  basePath,
  periods,
  selectedId,
  label = 'Periode',
}: {
  projectId?: string;
  basePath: string;
  periods: { id: string; label: string }[];
  selectedId: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <div className="space-y-1.5">
      <Label htmlFor="report-period">{label}</Label>
      <select
        id="report-period"
        className={cn(selectClassName, 'w-64')}
        value={selectedId}
        onChange={(e) => router.push(`${basePath}?period=${e.target.value}`)}
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label}
          </option>
        ))}
      </select>
    </div>
  );
}
