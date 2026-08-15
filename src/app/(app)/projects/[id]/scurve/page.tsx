import { Info, LineChart } from 'lucide-react';
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
import { formatDay, formatPercent } from '@/lib/format';
import { getScheduleOverview } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kurva-S' };

export default async function SCurvePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();
  const overview = await getScheduleOverview(user.id, projectId);

  const finalPct = overview.curve.at(-1)?.cumulativePct ?? '0';
  const reachesFull = Math.abs(Number(finalPct) - 1) <= 1e-6;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kurva-S Rencana"
        description="Kumulatif rencana progres: bobot tiap pekerjaan dikalikan porsi periodenya, lalu dijumlahkan berjalan."
        actions={
          <ButtonLink variant="outline" href={`/projects/${projectId}/schedule`}>
            Atur jadwal
          </ButtonLink>
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

          <SCurveChart curve={overview.curve} />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Rincian per periode</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Periode</TableHead>
                    <TableHead>Rentang</TableHead>
                    <TableHead className="w-32 text-right">Porsi</TableHead>
                    <TableHead className="w-32 text-right">Kumulatif</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.curve.map((point) => {
                    const period = overview.periods.find((p) => p.id === point.periodId);
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
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatPercent(point.plannedPct, 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatPercent(point.cumulativePct, 2)}
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
