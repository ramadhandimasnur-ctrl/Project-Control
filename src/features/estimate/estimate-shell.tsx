import { AlertTriangle, FileBarChart } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrency } from '@/lib/format';
import type { ProjectEstimate } from '@/services/ahsp';

/**
 * The parts RAB and RAP both need.
 *
 * The two pages answer different questions — what the job is worth against what
 * it costs to run — but they are priced from the same estimate and refuse the
 * same roles. Keeping the guards here means a role that must not see costs is
 * turned away identically on both, rather than on whichever page someone
 * remembered to protect.
 */

export function CostAccessNotice({ title }: { title: string }) {
  return (
    <Alert>
      <AlertTitle>{title} memuat angka biaya</AlertTitle>
      <AlertDescription>
        Peran Anda pada proyek ini tidak mencakup akses ke harga, biaya, dan margin.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Prices the estimate could not find.
 *
 * Shown on both pages because a missing price understates RAB and RAP alike,
 * and a total that is quietly incomplete is worse than no total at all.
 */
export function MissingPricesAlert({ missing }: { missing: ProjectEstimate['missingPrices'] }) {
  if (missing.length === 0) return null;

  return (
    <Alert>
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle>{missing.length} harga belum diisi, total di bawah belum lengkap</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-inside list-disc">
          {missing.slice(0, 10).map((price) => (
            <li key={`${price.resourceId}-${price.priceType}`}>
              Harga {price.priceType} untuk &ldquo;{price.name}&rdquo; ({price.code})
            </li>
          ))}
        </ul>
        {missing.length > 10 ? <p className="mt-1">…dan {missing.length - 10} lainnya.</p> : null}
      </AlertDescription>
    </Alert>
  );
}

export function NoWorkItems({ description }: { description: string }) {
  return <EmptyState icon={FileBarChart} title="Belum ada pekerjaan" description={description} />;
}

export function Kpi({
  label,
  value,
  caption,
  tone = 'default',
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'default' | 'negative';
}) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
          tone === 'negative' ? 'text-destructive' : ''
        }`}
      >
        {formatCurrency(value)}
      </dd>
      {caption ? <dd className="text-xs text-muted-foreground">{caption}</dd> : null}
    </div>
  );
}

export const WEIGHT_BASIS_LABELS = {
  CONTRACT: 'nilai kontrak',
  RAB: 'RAB',
  RAP: 'RAP',
} as const;
