import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ReportDocuments } from '@/features/progress/report-documents';
import { SignatureBlock } from '@/features/reports/signature-block';
import { canRecordFieldData } from '@/lib/auth/roles';
import { listPeriodDocuments } from '@/services/documents';
import { listSignatories } from '@/services/signatories';
import { getProject } from '@/services/projects';
import { SCurveChart } from '@/features/schedule/scurve-chart';
import { ZERO, toDecimal } from '@/lib/calc/decimal';
import { PROGRESS_STATUS_LABELS } from '@/lib/calc/progress';
import { isAppError } from '@/lib/errors';
import {
  EMPTY_VALUE,
  formatDateTime,
  formatDay,
  formatPercent,
  formatRatio,
} from '@/lib/format';
import {
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  PROGRESS_COLUMN_LABELS,
  REPORT_TYPE_LABELS,
} from '@/lib/reports/labels';
import { type ReportPayload, getSnapshot } from '@/services/reports';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Laporan Terbit' };

/**
 * A published report, exactly as it was published.
 *
 * Everything on this page comes out of the stored payload. Nothing is
 * recomputed and nothing is joined against current data — that is the entire
 * reason the snapshot exists, and a single "helpful" live lookup here would
 * quietly undo it.
 */
export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ id: string; snapshotId: string }>;
}) {
  const { id: projectId, snapshotId } = await params;
  const user = await requireSessionUser();

  const snapshot = await getSnapshot(user.id, projectId, snapshotId).catch((error: unknown) => {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
      notFound();
    }
    throw error;
  });

  const { payload } = snapshot;

  // Older snapshots predate the weighted columns and say nothing about their
  // period calendar; weekly is the wording those reports were written under.
  const columns = PROGRESS_COLUMN_LABELS[payload.periodType ?? 'WEEK'];
  const itemTotals = sumItems(payload.items);
  const hasWeighted = payload.items.some((item) => item.weighted !== undefined);

  /*
   * Only items whose id was frozen with the report can carry photographs.
   * Snapshots published before the id was recorded simply group none, rather
   * than being matched by name — a name collision would file a photograph
   * under the wrong work item, which on a printed report is a false claim.
   */
  const photoWorkItems = payload.items
    .filter((item): item is typeof item & { workItemId: string } => item.workItemId !== undefined)
    .map((item) => ({ id: item.workItemId, code: item.code, name: item.name }));

  /*
   * Photographs are read live rather than from the frozen payload, and that is
   * deliberate: they are evidence attached to a period, not a figure quoted at
   * a moment. Adding one after publishing enriches the report; it cannot alter
   * what the report claims, because every number on the page still comes from
   * the snapshot.
   */
  const [project, documents, signatories] = await Promise.all([
    getProject(user.id, projectId),
    listPeriodDocuments(user.id, projectId, payload.period.id),
    listSignatories(user.id, projectId),
  ]);
  const canRecord = canRecordFieldData(project.role);

  return (
    <div className="p-6">
      <div data-print="hide" className="mb-6 space-y-3">
        <PageHeader
          title={`Laporan ${REPORT_TYPE_LABELS[snapshot.reportType]} — ${payload.period.label}`}
          description={`Diterbitkan ${formatDateTime(new Date(snapshot.generatedAt))}`}
          actions={
            <ButtonLink variant="outline" href={`/projects/${projectId}/reports`}>
              Kembali ke Laporan
            </ButtonLink>
          }
        />

        <Alert>
          <Lock className="size-4" aria-hidden />
          <AlertTitle>Angka pada laporan ini dibekukan</AlertTitle>
          <AlertDescription>
            <p>
              Yang tampil adalah keadaan pada saat diterbitkan. Perubahan data setelah tanggal itu
              tidak mengubah isinya — untuk angka terkini, buka halaman Dashboard atau Kurva-S.
            </p>
            <p className="mt-2">
              Foto tersimpan permanen di server dan dibaca langsung, bukan dari salinan beku.
              Menambah foto setelah laporan terbit memperkaya lampirannya tanpa mengubah satu pun
              angka di atas — angkanya tetap berasal dari saat penerbitan.
            </p>
          </AlertDescription>
        </Alert>

        <div className="rounded-lg border p-3">
          <PaperSettings previewSelector="#snapshot-sheet" />
        </div>
      </div>

      <div id="snapshot-sheet" className="print-full mx-auto w-full space-y-6">
        <header data-print="keep-together" className="space-y-1 border-b pb-4">
          <h1 className="text-xl font-semibold">
            Laporan {REPORT_TYPE_LABELS[snapshot.reportType]}
          </h1>
          <p className="text-sm">
            <span className="font-mono text-muted-foreground">{payload.project.code}</span> ·{' '}
            {payload.project.name}
            {payload.project.location ? ` · ${payload.project.location}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">
            Periode {payload.period.label} · {formatDay(payload.period.startDate)} –{' '}
            {formatDay(payload.period.endDate)}
          </p>
          <p className="text-xs text-muted-foreground">
            Diterbitkan {formatDateTime(new Date(snapshot.generatedAt))}
          </p>
        </header>

        <section data-print="keep-together" className="space-y-2">
          <h2 className="text-sm font-semibold">Kemajuan fisik</h2>
          <dl className="grid gap-3 sm:grid-cols-4">
            <Figure label="Rencana" value={formatPercent(payload.physical.plannedCumulative, 2)} />
            <Figure label="Realisasi" value={formatPercent(payload.physical.actualCumulative, 2)} />
            <Figure label="Deviasi" value={formatPercent(payload.physical.deviation, 2)} />
            <Figure
              label="Status"
              value={PROGRESS_STATUS_LABELS[payload.physical.status]}
              caption={
                payload.physical.spi === null
                  ? undefined
                  : `SPI ${formatRatio(payload.physical.spi)}`
              }
            />
          </dl>
          {!payload.physical.fromBaseline ? (
            <p className="text-xs text-muted-foreground">
              Deviasi diukur terhadap rencana draf; proyek belum memiliki baseline aktif saat
              laporan ini terbit.
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Capaian pekerjaan</h2>
          {payload.items.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Tidak ada progres yang tercatat pada periode ini.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Kode</TableHead>
                    <TableHead>Uraian</TableHead>
                    <TableHead className="w-16">Sat</TableHead>
                    <TableHead className="w-24 text-right">Bobot</TableHead>
                    <TableHead className="w-28 text-right">{columns.previous}</TableHead>
                    <TableHead className="w-28 text-right">{columns.current}</TableHead>
                    <TableHead className="w-32 text-right">{columns.cumulative}</TableHead>
                    <TableHead className="w-28 text-right">Rencana</TableHead>
                    <TableHead className="w-28 text-right">Deviasi</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.items.map((item) => (
                    <TableRow key={item.code} data-print="keep-together">
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.unitCode}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatPercent(item.weight, 1)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatPercent(item.weighted?.previous, 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatPercent(item.weighted?.current, 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {formatPercent(item.weighted?.cumulative, 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatPercent(item.weighted?.planned, 2)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          Number(item.weighted?.deviation ?? 0) < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {formatPercent(item.weighted?.deviation, 2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.status ?? EMPTY_VALUE}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>

                {/*
                  Weighted columns exist so they can be added up; a report that
                  makes the reader do it by hand has thrown that away.
                  Suppressed on snapshots published before these columns
                  existed, where a row of zeros would be a claim about the
                  project rather than an absence of data.
                */}
                {hasWeighted ? (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>Jumlah</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(itemTotals.weight, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(itemTotals.previous, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(itemTotals.current, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(itemTotals.cumulative, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(itemTotals.planned, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(itemTotals.deviation, 2)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
                ) : null}
              </Table>
            </div>
          )}
        </section>

        {payload.curve ? (
          <section data-print="page-break" className="space-y-2">
            <h2 className="text-sm font-semibold">Kurva-S rencana dan realisasi</h2>
            <SCurveChart
              curve={payload.curve.map((point, index) => ({
                periodId: String(index),
                seq: index + 1,
                label: point.label,
                // The per-period share, recovered from the running totals the
                // snapshot froze.
                plannedPct: String(
                  Number(point.plannedCumulative) -
                    Number(payload.curve?.[index - 1]?.plannedCumulative ?? 0),
                ),
                cumulativePct: point.plannedCumulative,
                actualCumulative: point.actualCumulative,
              }))}
            />

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periode</TableHead>
                    <TableHead className="w-32 text-right">Rencana</TableHead>
                    <TableHead className="w-32 text-right">Realisasi</TableHead>
                    <TableHead className="w-32 text-right">Deviasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.curve.map((point) => (
                    <TableRow key={point.label} data-print="keep-together">
                      <TableCell>{point.label}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatPercent(point.plannedCumulative, 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {formatPercent(point.actualCumulative, 2)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          Number(point.deviation) < 0 ? 'text-destructive' : 'text-primary'
                        }`}
                      >
                        {formatPercent(point.deviation, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        {/*
          The same photo mechanism as the opname sheet, on all three published
          report types. Photographs attached during an inspection appear here
          grouped under their work item without being picked again, and extra
          ones can be added before printing.

          They are not part of the frozen payload, and cannot be: nothing is
          uploaded and nothing is stored — each photograph is an object URL
          pointing at a file in this browser. So a report reopened tomorrow, or
          on another machine, shows the same figures and no photographs. The
          notice below says so rather than leaving the reader to discover it.
        */}
        <section data-print="page-break" className="space-y-3">
          <h2 className="text-sm font-semibold">Lampiran dokumentasi</h2>
          <ReportDocuments
            projectId={projectId}
            periodId={payload.period.id}
            documents={documents}
            workItems={photoWorkItems}
            canEdit={canRecord}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Kendala lapangan</h2>
          {payload.issues.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Tidak ada kendala tercatat pada periode ini.
            </p>
          ) : (
            <ul className="space-y-2">
              {payload.issues.map((issue, index) => (
                <li key={index} data-print="keep-together" className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{issue.title}</p>
                    <span className="flex shrink-0 gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {ISSUE_SEVERITY_LABELS[issue.severity]}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {ISSUE_STATUS_LABELS[issue.status]}
                      </Badge>
                    </span>
                  </div>
                  {issue.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <SignatureBlock signatories={signatories} />
      </div>
    </div>
  );
}

/**
 * Column totals for the recap table.
 *
 * Reads the frozen payload and nothing else. A snapshot published before the
 * weighted columns existed contributes zero rather than being back-filled from
 * today's data — the whole point of freezing is that a report does not change
 * after it is handed over.
 */
function sumItems(items: ReportPayload['items']) {
  const add = (pick: (item: ReportPayload['items'][number]) => string | undefined) =>
    items.reduce((acc, item) => acc.plus(toDecimal(pick(item) ?? 0)), ZERO);

  return {
    weight: add((item) => item.weight),
    previous: add((item) => item.weighted?.previous),
    current: add((item) => item.weighted?.current),
    cumulative: add((item) => item.weighted?.cumulative),
    planned: add((item) => item.weighted?.planned),
    deviation: add((item) => item.weighted?.deviation),
  };
}

function Figure({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums">{value}</p>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
