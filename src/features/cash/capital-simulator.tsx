'use client';

import { Calculator } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The progress target the capital simulation is run against.
 *
 * The value lives in the URL rather than in component state so the result is
 * server-rendered from the same estimate as the rest of the page, and so a
 * particular scenario can be sent to someone as a link. Recomputing it in the
 * browser would mean shipping every work item's cost to the client and
 * maintaining a second copy of the arithmetic.
 */
export function CapitalSimulator({
  projectId,
  currentTarget,
  currentWeight,
}: {
  projectId: string;
  /** The target in force, as a percentage. */
  currentTarget: number;
  /** Approved progress now, as a percentage — the floor worth asking about. */
  currentWeight: number;
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
    startTransition(() => router.push(`/projects/${projectId}/capital?${next.toString()}`));
  };

  /*
   * Shortcuts skip the ones already behind: offering "sampai 25%" to a project
   * at 40% invites a simulation whose answer is always "nothing to do".
   */
  const shortcuts = [25, 50, 75, 100].filter((step) => step > currentWeight);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply(value);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="target-weight">Target bobot progres (%)</Label>
        <Input
          id="target-weight"
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

      {shortcuts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {shortcuts.map((step) => (
            <Button
              key={step}
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => apply(String(step))}
            >
              {step}%
            </Button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
