'use client';

import { Check, Loader2, RotateCcw, Save, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toDecimal } from '@/lib/calc/decimal';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type GanttRow, type PeriodRow } from '@/services/schedule';

import { autoDistributeAction, saveDistributionsAction } from './actions';

/**
 * The weight-over-time matrix.
 *
 * Cells are typed as whole percentages because that is how a scheduler talks
 * about them — "60% bulan ini" — while the column stores a 0..1 fraction. The
 * conversion happens here, at the boundary, so nothing downstream has to guess
 * which scale a number is on.
 *
 * The save control lives in a bar pinned above the table, not in a trailing
 * column. With a daily calendar the table is over a hundred columns wide, and a
 * button at the far right is a button nobody will ever find: the first version
 * of this shipped that way and every value typed into it was lost on refresh.
 */

const toPercentInput = (fraction: string | undefined): string =>
  fraction === undefined ? '' : toDecimal(fraction).times(100).toDecimalPlaces(4).toString();

const toFraction = (percentInput: string): string => {
  const trimmed = percentInput.trim();
  if (trimmed === '') return '0';
  return toDecimal(trimmed).dividedBy(100).toString();
};

/** Cell width; wide enough for "100" plus a caret, narrow enough to scan. */
const CELL_PX = 68;

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirtyIds = Object.keys(draft);

  /*
   * A last line of defence, not the fix. The visible save bar is what should
   * keep anyone from losing work; this only catches a closed tab.
   */
  useEffect(() => {
    if (dirtyIds.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyIds.length]);

  const valueOf = (workItemId: string, periodId: string): string =>
    draft[workItemId]?.[periodId] ?? toPercentInput(matrix[workItemId]?.[periodId]);

  const setCell = (workItemId: string, periodId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [workItemId]: { ...(current[workItemId] ?? {}), [periodId]: value },
    }));
  };

  const discard = (workItemId?: string) => {
    setDraft((current) => {
      if (workItemId === undefined) return {};
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

  const cellsOf = (workItemId: string) =>
    periods.map((period) => ({
      periodId: period.id,
      plannedPct: toFraction(valueOf(workItemId, period.id)),
    }));

  const saveRows = (ids: string[]) => {
    if (ids.length === 0) return;
    setBusyId(ids.length === 1 ? ids[0]! : 'all');

    startTransition(async () => {
      const result = await saveDistributionsAction(
        projectId,
        ids.map((workItemId) => ({ workItemId, cells: cellsOf(workItemId) })),
      );

      setBusyId(null);
      if (result.ok) {
        toast.success(
          result.rows === 1
            ? 'Distribusi tersimpan.'
            : `Distribusi ${result.rows} pekerjaan tersimpan.`,
          { description: `${result.cells} sel tercatat di basis data.` },
        );
        for (const id of ids) discard(id);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  const autoDistribute = (workItemId: string) => {
    setBusyId(workItemId);
    startTransition(async () => {
      const result = await autoDistributeAction(projectId, workItemId);
      setBusyId(null);
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

  const savingAll = pending && busyId === 'all';

  return (
    <div className="space-y-2">
      {/* Pinned above the table so it survives horizontal scrolling. */}
      {canEdit ? (
        <div
          className={cn(
            // top-14 clears the app header, which is itself sticky at z-30.
            'sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border p-2',
            dirtyIds.length > 0 ? 'border-primary/40 bg-primary/5' : 'bg-muted/30',
          )}
        >
          <span className="text-sm">
            {dirtyIds.length === 0
              ? 'Semua perubahan tersimpan.'
              : `${dirtyIds.length} baris diubah dan belum disimpan.`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {dirtyIds.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => discard()}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Batalkan
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={pending || dirtyIds.length === 0}
              onClick={() => saveRows(dirtyIds)}
            >
              {savingAll ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="size-3.5" aria-hidden />
              )}
              {savingAll ? 'Menyimpan…' : 'Simpan Distribusi'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs">
              <th
                scope="col"
                className="sticky left-0 z-10 w-64 min-w-64 bg-muted px-3 py-2 text-left"
              >
                Pekerjaan
              </th>
              {periods.map((period) => (
                <th
                  key={period.id}
                  scope="col"
                  className="border-l px-1 py-2 text-center font-medium text-muted-foreground"
                  style={{ minWidth: `${CELL_PX}px` }}
                  title={`${formatDay(period.startDate)} – ${formatDay(period.endDate)}`}
                >
                  <span className="block truncate">{period.label}</span>
                </th>
              ))}
              <th
                scope="col"
                className="sticky right-0 z-10 w-24 min-w-24 border-l bg-muted px-2 py-2 text-right"
              >
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = totalOf(row.workItemId);
              // 1e-4 in percent is the same millionth the service tolerates.
              const balanced = Math.abs(total - 100) <= 1e-4;
              const dirty = draft[row.workItemId] !== undefined;
              const busy = pending && (busyId === row.workItemId || busyId === 'all');

              return (
                <tr
                  key={row.workItemId}
                  className={cn('border-b last:border-b-0', dirty && 'bg-primary/5')}
                >
                  <th
                    scope="row"
                    className={cn(
                      'sticky left-0 z-10 px-3 py-1.5 text-left font-normal',
                      dirty ? 'bg-[color-mix(in_oklch,var(--background),var(--primary)_5%)]' : 'bg-background',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                      <span className="truncate">{row.name}</span>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="ml-auto shrink-0"
                          disabled={busy || row.plannedStart === null}
                          aria-label={`Sebar otomatis ${row.code}`}
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
                        </Button>
                      ) : null}
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
                      'sticky right-0 z-10 border-l px-2 py-1.5 text-right font-mono text-xs tabular-nums',
                      dirty ? 'bg-[color-mix(in_oklch,var(--background),var(--primary)_5%)]' : 'bg-background',
                      balanced ? 'text-muted-foreground' : 'font-medium text-destructive',
                    )}
                  >
                    {total === 0 ? '—' : `${Number(total.toFixed(4))}%`}
                    {dirty ? (
                      <Check className="ml-1 inline size-3 text-primary" aria-label="belum disimpan" />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
