import { FileText } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaperSettings } from '@/features/progress/paper-settings';
import { PeriodPicker } from '@/features/progress/period-picker';
import {
  PhotoCount,
  ReportPhotoPicker,
  ReportPhotoPlates,
} from '@/features/progress/report-photos';
import { ZERO, toDecimal } from '@/lib/calc/decimal';
import { PROGRESS_STATUS_LABELS } from '@/lib/calc/progress';
import { EMPTY_VALUE, formatDay, formatPercent, formatQuantity } from '@/lib/format';
import { PROGRESS_ENTRY_STATUS_LABELS } from '@/lib/progress/labels';
import {
  getProgressBoard,
  getProgressComparison,
  type ProgressBoardRow,
} from '@/services/progress';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Laporan Opname' };

/** Adds a weighted column down the page, in decimal rather than float. */
function sumOf(rows: readonly ProgressBoardRow[], pick: (row: ProgressBoardRow) => string) {
  return rows.reduce((acc, row) => acc.plus(toDecimal(pick(row))), ZERO);
}

const STATUS_LABELS = PROGRESS_ENTRY_STATUS_LABELS;

/**
 * Site inspection report for one period, laid out to be printed.
 *
 * Everything that is navigation rather than content carries `data-print="hide"`
 * and disappears on paper, so the page the user reads and the page they hand
 * over are the same page — no second template to drift out of step.
 */
export default async function OpnameReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();

  const [project, board, comparison] = await Promise.all([
    getProject(user.id, projectId),
    getProgressBoard(user.id, projectId, query.period),
    getProgressComparison(user.id, projectId),
  ]);

  const period = board.periods.find((p) => p.id === board.selectedPeriodId) ?? null;

  if (board.periods.length === 0 || period === null) {
    return (
      <div className="space-y-6 p-6">
        <EmptyState
          icon={FileText}
          title="Belum ada periode"
          description="Laporan opname disusun per periode. Bangun kalender periode proyek terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/schedule`}>Buka Periode &amp; Jadwal</ButtonLink>
          }
        />
      </div>
    );
  }

  const reported = board.rows.filter((row) => row.status !== null);
  const atPeriod = comparison.points.find((point) => point.periodId === period.id) ?? null;
  const workItems = board.rows.map((row) => ({
    id: row.workItemId,
    code: row.code,
    name: row.name,
  }));

  return (
    <div className="p-6">
      <div data-print="hide" className="mb-6 space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <PeriodPicker
            projectId={projectId}
            basePath={`/projects/${projectId}/reports/opname`}
            periods={board.periods}
            selectedId={period.id}
          />
          <PhotoCount periodId={period.id} workItemIds={workItems.map((w) => w.id)} />
        </div>
        <PaperSettings previewSelector="#opname-sheet" />
      </div>

      {/*
        The sheet is width-limited to the printable area by PaperSettings, so
        what is arranged on screen is what lands on paper.
      */}
      <div id="opname-sheet" className="print-full mx-auto w-full space-y-6">

      {/* --- the printed sheet starts here --- */}

      <header data-print="keep-together" className="space-y-1 border-b pb-4">
        <h1 className="text-xl font-semibold">Laporan Opname Lapangan</h1>
        <p className="text-sm">
          <span className="font-mono text-muted-foreground">{project.code}</span> · {project.name}
          {project.location ? ` · ${project.location}` : ''}
        </p>
        <p className="text-sm text-muted-foreground">
          Periode {period.label} · {formatDay(period.startDate)} – {formatDay(period.endDate)}
        </p>
        <p className="text-xs text-muted-foreground">
          Dicetak {formatDay(new Date().toISOString().slice(0, 10))} oleh {user.fullName}
        </p>
      </header>

      <section data-print="keep-together" className="grid gap-3 sm:grid-cols-4">
        <Figure label="Rencana kumulatif" value={formatPercent(atPeriod?.plannedCumulative ?? 0, 2)} />
        <Figure label="Realisasi kumulatif" value={formatPercent(atPeriod?.actualCumulative ?? 0, 2)} />
        <Figure label="Deviasi" value={formatPercent(atPeriod?.deviation ?? 0, 2)} />
        <Figure
          label="Status"
          value={atPeriod ? PROGRESS_STATUS_LABELS[atPeriod.status] : EMPTY_VALUE}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Capaian pekerjaan</h2>
        {reported.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Belum ada progres yang dicatat pada periode ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead>Uraian</TableHead>
                  <TableHead className="w-20">Sat</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="w-24 text-right">Periode ini</TableHead>
                  <TableHead className="w-24 text-right">Kumulatif</TableHead>
                  <TableHead className="w-24 text-right">Bobot ini</TableHead>
                  <TableHead className="w-28 text-right">Bobot s.d. ini</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  {board.requireChecklist ? <TableHead className="w-20">Mutu</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reported.map((row) => (
                  <TableRow key={row.workItemId} data-print="keep-together">
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.unitCode}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.qtyThisPeriod)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(row.pctThisPeriod, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(toDecimal(row.earnedBefore).plus(row.pctThisPeriod), 2)}
                    </TableCell>

                    {/*
                      The same progress expressed against the whole project, so
                      the two figures at the head of this sheet can be checked
                      by adding the column up.
                    */}
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(row.weighted.current, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(row.weighted.cumulative, 2)}
                    </TableCell>
                    <TableCell>
                      {row.status ? (
                        <Badge variant="outline" className="text-[10px]">
                          {STATUS_LABELS[row.status]}
                        </Badge>
                      ) : null}
                    </TableCell>
                    {board.requireChecklist ? (
                      <TableCell className="text-xs">
                        {row.checklistVerdict === 'PASS'
                          ? 'Lulus'
                          : row.checklistVerdict === 'FAIL'
                            ? 'Gagal'
                            : EMPTY_VALUE}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>

              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6}>Jumlah bobot</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(sumOf(reported, (row) => row.weighted.current), 2)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(sumOf(reported, (row) => row.weighted.cumulative), 2)}
                  </TableCell>
                  <TableCell colSpan={board.requireChecklist ? 2 : 1} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </section>

      <ReportPhotoPicker periodId={period.id} />

      <section data-print="page-break" className="space-y-3">
        <h2 className="text-sm font-semibold">Lampiran dokumentasi</h2>
        <ReportPhotoPlates periodId={period.id} workItems={workItems} />
      </section>

      <section data-print="keep-together" className="grid gap-8 pt-8 sm:grid-cols-3">
        {['Disusun oleh', 'Diperiksa oleh', 'Disetujui oleh'].map((role) => (
          <div key={role} className="space-y-10 text-center text-sm">
            <p>{role}</p>
            <p className="border-t pt-1 text-muted-foreground">(&nbsp;&nbsp;&nbsp;&nbsp;)</p>
          </div>
        ))}
        </section>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
