'use client';

import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { barPosition } from '@/lib/calc/schedule';
import { ganttScale, isLabelled } from '@/lib/ui/gantt-scale';
import { formatDay, formatPercent } from '@/lib/format';
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
 *
 * The track is given a width proportional to the number of periods and allowed
 * to scroll. Fitting 123 daily columns onto one screen was what made short
 * tasks look like slivers stacked against the left edge; the geometry was
 * always right, the canvas was too small to show it.
 */

const LABEL_COL = 'w-72 min-w-72';

export function GanttChart({
  projectId,
  projectStart,
  projectEnd,
  periodType,
  periods,
  rows,
  canEdit,
}: {
  projectId: string;
  projectStart: string;
  projectEnd: string;
  periodType: 'DAY' | 'WEEK' | 'MONTH';
  periods: PeriodRow[];
  rows: GanttRow[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<GanttRow | null>(null);

  const { trackWidthPx, labelStride } = ganttScale(periods.length, periodType);
  const scheduled = rows.filter((row) => row.plannedStart !== null);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <div className="w-max min-w-full">
          <div className="flex border-b bg-muted/40 text-xs font-medium">
            <div
              className={cn(
                LABEL_COL,
                'sticky left-0 z-20 shrink-0 border-r bg-muted px-3 py-2',
              )}
            >
              Pekerjaan
            </div>
            <div className="flex shrink-0" style={{ width: `${trackWidthPx}px` }}>
              {periods.map((period, index) => {
                const labelled = isLabelled(index, labelStride);

                return (
                  <div
                    key={period.id}
                    /*
                     * Deliberately not clipped. A daily column is 26px wide and
                     * a date needs about 76, which is exactly what labelStride
                     * buys by leaving the next few columns empty — but only if
                     * the label is allowed to spill into them. Clipping here
                     * turned "15 Agt" into "15 A".
                     */
                    className={cn(
                      'relative shrink-0 py-2 text-muted-foreground',
                      labelled ? 'border-l' : '',
                    )}
                    style={{ width: `${trackWidthPx / periods.length}px` }}
                    title={`${period.label} · ${formatDay(period.startDate)} – ${formatDay(period.endDate)}`}
                  >
                    {labelled ? (
                      // Absolute, so a long label never widens the column it
                      // marks and never shifts the ticks after it.
                      <span className="absolute top-2 left-1 whitespace-nowrap text-[10px] leading-4">
                        {period.label}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {rows.map((row) => {
            const bar =
              row.plannedStart === null || row.plannedFinish === null
                ? null
                : barPosition(projectStart, projectEnd, row.plannedStart, row.plannedFinish);

            return (
              <div key={row.workItemId} className="flex border-b text-sm last:border-b-0">
                <div
                  className={cn(
                    LABEL_COL,
                    'sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r bg-background px-3 py-2',
                  )}
                >
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

                <div className="relative shrink-0 py-2" style={{ width: `${trackWidthPx}px` }}>
                  {/* Gridlines only where the axis is labelled, so they stay readable. */}
                  <div aria-hidden className="absolute inset-0 flex">
                    {periods.map((period, index) => (
                      <div
                        key={period.id}
                        className={cn('shrink-0', isLabelled(index, labelStride) ? 'border-l' : '')}
                        style={{ width: `${trackWidthPx / periods.length}px` }}
                      />
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
                          'absolute top-0 flex h-6 min-w-1 items-center overflow-hidden rounded-md bg-primary/80 text-[10px] text-primary-foreground',
                          canEdit && 'hover:bg-primary',
                          !row.distributionComplete && 'ring-2 ring-destructive ring-offset-1',
                        )}
                        style={{
                          left: `${bar.offsetPct.times(100).toNumber()}%`,
                          width: `${bar.widthPct.times(100).toNumber()}%`,
                        }}
                      >
                        <span className="truncate px-1.5">{row.durationDays} hr</span>
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
        <span>Geser mendatar untuk menyusuri {periods.length} periode.</span>
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
