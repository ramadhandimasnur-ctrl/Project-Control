'use client';

import { Check, Loader2, RotateCcw, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toDecimal } from '@/lib/calc/decimal';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type GanttRow, type PeriodRow } from '@/services/schedule';

import { autoDistributeAction, saveDistributionAction } from './actions';

/**
 * The weight-over-time matrix.
 *
 * Cells are typed as whole percentages because that is how a scheduler talks
 * about them — "60% bulan ini" — while the column stores a 0..1 fraction. The
 * conversion happens here, at the boundary, so nothing downstream has to guess
 * which scale a number is on.
 *
 * A row is saved as a whole. Saving cell by cell would leave the matrix at
 * `Σ ≠ 1` between two writes, which is exactly the state that blocks a
 * baseline.
 */

const toPercentInput = (fraction: string | undefined): string =>
  fraction === undefined ? '' : toDecimal(fraction).times(100).toDecimalPlaces(4).toString();

const toFraction = (percentInput: string): string => {
  const trimmed = percentInput.trim();
  if (trimmed === '') return '0';
  return toDecimal(trimmed).dividedBy(100).toString();
};

export function DistributionMatrix({
  projectId,
  periods,
  rows,
  matrix,
  canEdit,
}: {
  projectId: string;
  periods: PeriodRow[];
  rows: GanttRow[];
  matrix: Record<string, Record<string, string>>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valueOf = (workItemId: string, periodId: string): string =>
    draft[workItemId]?.[periodId] ?? toPercentInput(matrix[workItemId]?.[periodId]);

  const isDirty = (workItemId: string): boolean => draft[workItemId] !== undefined;

  const setCell = (workItemId: string, periodId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [workItemId]: { ...(current[workItemId] ?? {}), [periodId]: value },
    }));
  };

  const discard = (workItemId: string) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[workItemId];
      return next;
    });
  };

  /** Live total for the row, in percent, so an unbalanced row shows as it is typed. */
  const totalOf = (workItemId: string): number =>
    periods.reduce((acc, period) => {
      const raw = valueOf(workItemId, period.id).trim();
      if (raw === '') return acc;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? acc + parsed : acc;
    }, 0);

  const save = (workItemId: string) => {
    setSavingId(workItemId);
    startTransition(async () => {
      const result = await saveDistributionAction(
        projectId,
        workItemId,
        periods.map((period) => ({
          periodId: period.id,
          plannedPct: toFraction(valueOf(workItemId, period.id)),
        })),
      );

      setSavingId(null);
      if (result.ok) {
        toast.success('Distribusi tersimpan.');
        discard(workItemId);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  const autoDistribute = (workItemId: string) => {
    setSavingId(workItemId);
    startTransition(async () => {
      const result = await autoDistributeAction(projectId, workItemId);
      setSavingId(null);
      if (result.ok) {
        toast.success(`Tersebar ke ${result.cells} periode.`);
        discard(workItemId);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  if (periods.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs">
            <th scope="col" className="sticky left-0 z-10 w-64 bg-muted/40 px-3 py-2 text-left">
              Pekerjaan
            </th>
            {periods.map((period) => (
              <th
                key={period.id}
                scope="col"
                className="min-w-20 border-l px-1.5 py-2 text-center font-medium text-muted-foreground"
                title={`${formatDay(period.startDate)} – ${formatDay(period.endDate)}`}
              >
                {period.label}
              </th>
            ))}
            <th scope="col" className="w-20 border-l px-2 py-2 text-right">
              Σ
            </th>
            {canEdit ? <th scope="col" className="w-32 border-l px-2 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = totalOf(row.workItemId);
            // 1e-4 in percent is the same millionth the service tolerates.
            const balanced = Math.abs(total - 100) <= 1e-4;
            const dirty = isDirty(row.workItemId);
            const busy = pending && savingId === row.workItemId;

            return (
              <tr key={row.workItemId} className="border-b last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                    <span className="truncate">{row.name}</span>
                  </span>
                </th>

                {periods.map((period) => (
                  <td key={period.id} className="border-l px-1 py-1">
                    <Input
                      aria-label={`${row.code} pada ${period.label}`}
                      inputMode="decimal"
                      disabled={!canEdit || busy}
                      value={valueOf(row.workItemId, period.id)}
                      onChange={(e) => setCell(row.workItemId, period.id, e.target.value)}
                      className="h-7 border-transparent bg-transparent px-1 text-right font-mono text-xs tabular-nums hover:border-input focus:border-input"
                      placeholder="—"
                    />
                  </td>
                ))}

                <td
                  className={cn(
                    'border-l px-2 py-1.5 text-right font-mono text-xs tabular-nums',
                    balanced ? 'text-muted-foreground' : 'font-medium text-destructive',
                  )}
                >
                  {total === 0 ? '—' : `${Number(total.toFixed(4))}%`}
                </td>

                {canEdit ? (
                  <td className="border-l px-1 py-1">
                    <div className="flex justify-end gap-0.5">
                      {dirty ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Batalkan perubahan baris"
                            disabled={busy}
                            onClick={() => discard(row.workItemId)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => save(row.workItemId)}
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Check className="size-3.5" aria-hidden />
                            )}
                            Simpan
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || row.plannedStart === null}
                          title={
                            row.plannedStart === null
                              ? 'Tentukan tanggal rencana terlebih dahulu.'
                              : 'Sebar merata sepanjang tanggal rencana.'
                          }
                          onClick={() => autoDistribute(row.workItemId)}
                        >
                          {busy ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Wand2 className="size-3.5" aria-hidden />
                          )}
                          Sebar
                        </Button>
                      )}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
