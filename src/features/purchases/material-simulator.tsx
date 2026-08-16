'use client';

import { Calculator } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import { cn } from '@/lib/utils';

export type TermOption = {
  id: string;
  label: string;
  /** The progress the term unlocks at, as a 0..1 fraction. */
  triggerProgressPct: string;
};

/**
 * Picks the scope the material list is calculated for.
 *
 * Two ways in, one answer: a payment term is just a progress target with a
 * name on it, so choosing a term fills the percentage rather than running a
 * second calculation. Keeping them as one path means the purchasing list for
 * "termin 2" and for "50%" cannot disagree when the term triggers at 50%.
 */
export function MaterialSimulator({
  projectId,
  currentTarget,
  currentWeight,
  terms,
}: {
  projectId: string;
  currentTarget: number;
  currentWeight: number;
  terms: TermOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(String(currentTarget));
  const [pending, startTransition] = useTransition();

  const apply = (target: string) => {
    const parsed = Number(target);
    if (!Number.isFinite(parsed)) return;

    const clamped = Math.min(Math.max(parsed, 0), 100);
    setValue(String(clamped));

    const next = new URLSearchParams(params.toString());
    next.set('target', String(clamped));
    startTransition(() => router.push(`/projects/${projectId}/material?${next.toString()}`));
  };

  const usableTerms = terms.filter((term) => Number(term.triggerProgressPct) > 0);

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          apply(value);
        }}
      >
        {usableTerms.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="term-scope">Termin</Label>
            <select
              id="term-scope"
              className={cn(selectClassName, 'w-72')}
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                const term = usableTerms.find((row) => row.id === event.target.value);
                if (term) apply(String(Number(term.triggerProgressPct) * 100));
              }}
            >
              <option value="">— Pilih termin —</option>
              {usableTerms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="material-target">Target bobot progres (%)</Label>
          <Input
            id="material-target"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            className="w-40"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>

        <Button type="submit" disabled={pending}>
          <Calculator className="size-4" aria-hidden />
          Hitung kebutuhan
        </Button>
      </form>

      {usableTerms.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Belum ada termin dengan pemicu progres. Isi pemicunya di Kas &amp; Termin agar simulasi
          dapat dipilih per termin, atau ketik targetnya langsung di atas. Progres disetujui saat
          ini {currentWeight.toFixed(2)}%.
        </p>
      ) : null}
    </div>
  );
}
