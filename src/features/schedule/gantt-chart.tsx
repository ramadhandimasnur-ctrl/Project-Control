'use client';

import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { barPosition } from '@/lib/calc/schedule';
import { EMPTY_VALUE, formatDay, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type GanttRow, type PeriodRow } from '@/services/schedule';

import { ScheduleDialog } from './schedule-dialog';

/**
 * Planned bars over the project's own span.
 *
 * Bars are positioned as percentages of the whole timeline rather than by
 * counting period columns: periods are rarely equal — the first and last are
 * usually partial — so a column-counting bar would drift away from the dates it
 * claims to show.
 */
export function GanttChart({
  projectId,
  projectStart,
  projectEnd,
  periods,
  rows,
  canEdit,
}: {
  projectId: string;
  projectStart: string;
  projectEnd: string;
  periods: PeriodRow[];
  rows: GanttRow[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<GanttRow | null>(null);

  const scheduled = rows.filter((row) => row.plannedStart !== null);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-[52rem]">
          <div className="flex border-b bg-muted/40 text-xs font-medium">
            <div className="w-72 shrink-0 border-r px-3 py-2">Pekerjaan</div>
            <div className="relative flex-1">
              <div className="flex h-full">
                {periods.map((period) => (
                  <div
                    key={period.id}
                    className="flex-1 truncate border-r px-1.5 py-2 text-center text-muted-foreground last:border-r-0"
                    title={`${formatDay(period.startDate)} – ${formatDay(period.endDate)}`}
                  >
                    {period.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {rows.map((row) => {
            const bar =
              row.plannedStart === null || row.plannedFinish === null
                ? null
                : barPosition(projectStart, projectEnd, row.plannedStart, row.plannedFinish);

            return (
              <div key={row.workItemId} className="flex border-b text-sm last:border-b-0">
                <div className="flex w-72 shrink-0 items-center gap-2 border-r px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                  <span className="truncate">{row.name}</span>
                  {row.includeInProgressWeight ? (
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {formatPercent(row.weight, 1)}
                    </span>
                  ) : (
                    <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                      tanpa bobot
                    </Badge>
                  )}
                </div>

                <div className="relative flex-1 py-2">
                  {/* Gridlines echo the period columns so a bar can be read against them. */}
                  <div aria-hidden className="absolute inset-0 flex">
                    {periods.map((period) => (
                      <div key={period.id} className="flex-1 border-r last:border-r-0" />
                    ))}
                  </div>

                  {bar === null ? (
                    <div className="relative px-3 text-xs text-muted-foreground">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing(row)}
                          className="inline-flex items-center gap-1 rounded hover:text-foreground hover:underline"
                        >
                          <CalendarPlus className="size-3.5" aria-hidden />
                          Tentukan tanggal
                        </button>
                      ) : (
                        'Belum dijadwalkan'
                      )}
                    </div>
                  ) : (
                    <div className="relative h-6">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setEditing(row)}
                        title={`${formatDay(row.plannedStart)} – ${formatDay(row.plannedFinish)} (${row.durationDays} hari)`}
                        className={cn(
                          'absolute top-0 h-6 min-w-[2px] rounded-md bg-primary/80 px-2 text-left text-[10px] leading-6 text-primary-foreground',
                          canEdit && 'hover:bg-primary',
                          !row.distributionComplete && 'ring-2 ring-destructive ring-offset-1',
                        )}
                        style={{
                          left: `${bar.offsetPct.times(100).toNumber()}%`,
                          width: `${bar.widthPct.times(100).toNumber()}%`,
                        }}
                      >
                        <span className="truncate">{row.durationDays} hr</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {scheduled.length} dari {rows.length} pekerjaan sudah punya tanggal.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded-sm bg-primary/80" />
          rencana
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm bg-primary/80 ring-2 ring-destructive"
          />
          distribusinya belum genap 100%
        </span>
      </div>

      {editing ? (
        <ScheduleDialog
          open
          onOpenChange={(open) => setEditing(open ? editing : null)}
          projectId={projectId}
          row={editing}
          options={rows
            .filter((row) => row.workItemId !== editing.workItemId)
            .map((row) => ({ id: row.workItemId, code: row.code, name: row.name }))}
        />
      ) : null}
    </>
  );
}

/** Compact read-only summary of an item's dates, used by the matrix header. */
export function ScheduleSummary({ row }: { row: GanttRow }) {
  if (row.plannedStart === null || row.plannedFinish === null) {
    return <span className="text-muted-foreground">{EMPTY_VALUE}</span>;
  }
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      {formatDay(row.plannedStart, 'd MMM')} – {formatDay(row.plannedFinish, 'd MMM')}
    </span>
  );
}
