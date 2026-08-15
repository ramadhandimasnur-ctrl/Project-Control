import { FileSpreadsheet, Info, LineChart } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SCurveChart } from '@/features/schedule/scurve-chart';
import { PROGRESS_STATUS_LABELS } from '@/lib/calc/progress';
import { EMPTY_VALUE, formatDay, formatPercent } from '@/lib/format';
import { getProgressComparison } from '@/services/progress';
import { getScheduleOverview } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kurva-S' };

export default async function SCurvePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const [overview, comparison] = await Promise.all([
    getScheduleOverview(user.id, projectId),
    getProgressComparison(user.id, projectId),
  ]);

  const finalPct = overview.curve.at(-1)?.cumulativePct ?? '0';
  const reachesFull = Math.abs(Number(finalPct) - 1) <= 1e-6;

  // Beyond the last reported period the realised line stops rather than
  // sliding to zero, which would read as a collapse instead of "not yet".
  const lastReported = comparison.points.filter((point) => point.spi !== null).at(-1)?.seq ?? null;
  const actualBy = new Map(
    comparison.points.map((point) => [point.periodId, point.actualCumulative.toString()]),
  );

  const curve = overview.curve.map((point) => ({
    ...point,
    actualCumulative:
      lastReported !== null && point.seq <= lastReported
        ? (actualBy.get(point.periodId) ?? null)
        : null,
  }));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kurva-S Rencana"
        description="Kumulatif rencana progres: bobot tiap pekerjaan dikalikan porsi periodenya, lalu dijumlahkan berjalan."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink variant="outline" href={`/projects/${projectId}/exports/progress`}>
              <FileSpreadsheet className="size-4" aria-hidden />
              Ekspor Excel
            </ButtonLink>
            <ButtonLink variant="outline" href={`/projects/${projectId}/schedule`}>
              Atur jadwal
            </ButtonLink>
          </div>
        }
      />

      {overview.periods.length === 0 || overview.curve.length === 0 ? (
        <EmptyState
          icon={LineChart}
          title="Kurva belum dapat digambar"
          description="Kurva-S terbentuk dari periode dan distribusi bobot. Bangun periode lalu sebar bobot pekerjaannya terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/schedule`}>Buka Periode &amp; Jadwal</ButtonLink>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {overview.curveFromBaseline && overview.activeBaseline ? (
              <Badge variant="secondary">Baseline: {overview.activeBaseline.name}</Badge>
            ) : (
              <Badge variant="outline">Rencana draf</Badge>
            )}
            <span>{overview.periods.length} periode</span>
          </div>

          {/*
            Which set of numbers is on screen matters more than the drawing:
            a draft curve moves whenever anyone edits a cell, a baseline does not.
          */}
          {overview.curveFromBaseline ? null : (
            <Alert>
              <Info className="size-4" aria-hidden />
              <AlertTitle>Kurva ini dibaca dari rencana yang masih dapat berubah</AlertTitle>
              <AlertDescription>
                Proyek ini belum punya baseline aktif, jadi garisnya ikut bergeser setiap kali
                distribusi diubah. Kunci baseline agar ada acuan tetap untuk menilai progres.
              </AlertDescription>
            </Alert>
          )}

          {reachesFull ? null : (
            <Alert variant="destructive">
              <AlertTitle>Kurva tidak berakhir di 100%</AlertTitle>
              <AlertDescription>
                Kumulatif terakhir {formatPercent(finalPct, 2)}. Ada pekerjaan berbobot yang belum
                tersebar penuh, sehingga rencana ini belum menggambarkan keseluruhan lingkup.
              </AlertDescription>
            </Alert>
          )}

          <SCurveChart curve={curve} />

          {comparison.hasActual ? (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Periode terakhir" value={comparison.current.periodLabel ?? EMPTY_VALUE} />
              <Stat label="Rencana" value={formatPercent(comparison.current.plannedCumulative, 2)} />
              <Stat label="Realisasi" value={formatPercent(comparison.current.actualCumulative, 2)} />
              <Stat
                label="Deviasi"
                value={formatPercent(comparison.current.deviation, 2)}
                caption={PROGRESS_STATUS_LABELS[comparison.current.status]}
              />
            </dl>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Rincian per periode</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Periode</TableHead>
                    <TableHead>Rentang</TableHead>
                    <TableHead className="w-28 text-right">Porsi</TableHead>
                    <TableHead className="w-28 text-right">Rencana</TableHead>
                    <TableHead className="w-28 text-right">Realisasi</TableHead>
                    <TableHead className="w-28 text-right">Deviasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {curve.map((point) => {
                    const period = overview.periods.find((p) => p.id === point.periodId);
                    const reported = point.actualCumulative !== null;
                    const deviation =
                      point.actualCumulative === null
                        ? null
                        : Number(point.actualCumulative) - Number(point.cumulativePct);

                    return (
                      <TableRow key={point.periodId}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {point.seq}
                        </TableCell>
                        <TableCell>{point.label}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {period
                            ? `${formatDay(period.startDate, 'd MMM')} – ${formatDay(period.endDate, 'd MMM yyyy')}`
                            : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {formatPercent(point.plannedPct, 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatPercent(point.cumulativePct, 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {reported ? formatPercent(point.actualCumulative!, 2) : EMPTY_VALUE}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono tabular-nums ${
                            deviation === null
                              ? 'text-muted-foreground'
                              : deviation < 0
                                ? 'text-destructive'
                                : 'text-primary'
                          }`}
                        >
                          {deviation === null ? EMPTY_VALUE : formatPercent(deviation, 2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
