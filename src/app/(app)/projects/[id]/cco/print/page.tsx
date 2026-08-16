import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
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
import { SignatureBlock } from '@/features/reports/signature-block';
import { isAppError } from '@/lib/errors';
import { EMPTY_VALUE, formatCurrency, formatDay, formatPercent, formatQuantity } from '@/lib/format';
import { REVISION_KIND_LABELS } from '@/lib/validation/contract-revision';
import {
  getRevision,
  getScopeComparison,
  listRevisions,
  REVISION_STATUS_LABELS,
} from '@/services/contract-revisions';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';
import { listSignatories } from '@/services/signatories';

export const metadata: Metadata = { title: 'Cetak CCO' };

/**
 * The addendum, on paper.
 *
 * Two tables, because an addendum answers two questions that are easy to
 * confuse: what this particular revision changes, and where the scope now
 * stands against the contract as originally signed. A document with only the
 * first cannot be checked against the contract; one with only the second
 * cannot be signed.
 */
export default async function CcoPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const { id: projectId } = await params;
  const { revision: revisionId } = await searchParams;

  const user = await requireSessionUser();

  const [project, comparison, signatories, revisions] = await Promise.all([
    getProject(user.id, projectId),
    getScopeComparison(user.id, projectId),
    listSignatories(user.id, projectId),
    listRevisions(user.id, projectId),
  ]);

  const revision =
    revisionId === undefined
      ? null
      : await getRevision(user.id, projectId, revisionId).catch((error: unknown) => {
          if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
            notFound();
          }
          throw error;
        });

  const approved = revisions.filter((row) => row.status === 'APPROVED');

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div data-print="hide" className="space-y-4">
        <PageHeader
          title="Cetak laporan CCO"
          description={
            revision === null
              ? 'Rekap seluruh perubahan lingkup terhadap Baseline 0.'
              : `Rincian ${revision.code} beserta rekap lingkup terhadap Baseline 0.`
          }
        />
        <div className="rounded-lg border p-3">
          <PaperSettings previewSelector="#cco-sheet" />
        </div>
      </div>

      <div id="cco-sheet" className="print-full mx-auto w-full space-y-6">
        <header data-print="keep-together" className="space-y-1 border-b pb-4">
          <h1 className="text-xl font-semibold">
            Laporan Pekerjaan Tambah/Kurang
            {revision === null ? '' : ` — ${revision.code}`}
          </h1>
          <p className="text-sm">
            <span className="font-mono text-muted-foreground">{project.code}</span> · {project.name}
            {project.location ? ` · ${project.location}` : ''}
          </p>
          {project.contractNo ? (
            <p className="text-xs text-muted-foreground">Kontrak {project.contractNo}</p>
          ) : null}
          {comparison.frozenAt ? (
            <p className="text-xs text-muted-foreground">
              Baseline 0 dikunci {formatDay(comparison.frozenAt.slice(0, 10))}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Baseline 0 belum dikunci, sehingga kolom &ldquo;awal&rdquo; di bawah masih kosong.
            </p>
          )}
        </header>

        {revision === null ? null : (
          <section data-print="keep-together" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">
                {revision.code} — {revision.title}
              </h2>
              <Badge variant="outline">{REVISION_STATUS_LABELS[revision.status]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Berlaku {formatDay(revision.effectiveDate)}
              {revision.reason ? ` · ${revision.reason}` : ''}
            </p>

            <div className="w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Kode</TableHead>
                    <TableHead>Uraian</TableHead>
                    <TableHead className="w-24">Jenis</TableHead>
                    <TableHead className="w-14">Sat</TableHead>
                    <TableHead className="w-24 text-right">Vol awal</TableHead>
                    <TableHead className="w-24 text-right">Vol akhir</TableHead>
                    <TableHead className="w-24 text-right">Selisih</TableHead>
                    <TableHead className="w-32 text-right">Nilai selisih</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revision.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-xs">{line.code}</TableCell>
                      <TableCell>
                        {line.name}
                        {line.note ? (
                          <span className="block text-xs text-muted-foreground">{line.note}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {REVISION_KIND_LABELS[line.kind]}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{line.unitCode}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(line.volumeBefore)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(line.volumeAfter)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(line.volumeDelta)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          Number(line.valueDelta) < 0 ? 'text-destructive' : ''
                        }`}
                      >
                        {formatCurrency(line.valueDelta)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={7}>Pekerjaan tambah</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(revision.summary.addedValue)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={7}>Pekerjaan kurang</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(revision.summary.removedValue)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={7}>Nilai bersih revisi</TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {formatCurrency(revision.summary.netValue)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <Pair
                label="Nilai kontrak sebelum"
                value={formatCurrency(revision.summary.contractValueBefore)}
              />
              <Pair
                label="Nilai kontrak addendum"
                value={formatCurrency(revision.summary.contractValueAfter)}
              />
              <Pair
                label="Perubahan"
                value={
                  revision.summary.netPercent === null
                    ? EMPTY_VALUE
                    : formatPercent(revision.summary.netPercent)
                }
              />
            </dl>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-base font-semibold">
            Rekap lingkup: Baseline 0 terhadap keadaan sekarang
          </h2>
          <p className="text-xs text-muted-foreground">
            {approved.length === 0
              ? 'Belum ada revisi yang disetujui, sehingga kedua kolom masih sama.'
              : `Mencakup ${approved.length} revisi yang telah disetujui: ${approved
                  .map((row) => row.code)
                  .reverse()
                  .join(', ')}.`}
          </p>

          <div className="w-full rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead>Uraian</TableHead>
                  <TableHead className="w-14">Sat</TableHead>
                  <TableHead className="w-24 text-right">Vol awal</TableHead>
                  <TableHead className="w-24 text-right">Vol akhir</TableHead>
                  <TableHead className="w-32 text-right">Nilai awal</TableHead>
                  <TableHead className="w-32 text-right">Nilai akhir</TableHead>
                  <TableHead className="w-28 text-right">Selisih nilai</TableHead>
                  <TableHead className="w-24 text-right">Bobot awal</TableHead>
                  <TableHead className="w-24 text-right">Bobot akhir</TableHead>
                  <TableHead className="w-24 text-right">Δ bobot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.rows.map((row) => (
                  <TableRow key={row.workItemId ?? row.code}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.unitCode}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.baselineVolume)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.currentVolume)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(row.baselineValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(row.currentValue)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        Number(row.valueDelta) < 0 ? 'text-destructive' : ''
                      }`}
                    >
                      {formatCurrency(row.valueDelta)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(row.baselineWeight, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(row.currentWeight, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(row.weightDelta, 2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Jumlah</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(comparison.totals.baselineValue)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(comparison.totals.currentValue)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono font-semibold tabular-nums ${
                      Number(comparison.totals.valueDelta) < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {formatCurrency(comparison.totals.valueDelta)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(1)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(1)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Bobot dihitung ulang dari volume terakhir, sehingga kolom bobot akhir tetap berjumlah
            100% setelah revisi. Selisih bobot per pekerjaan bisa bernilai negatif meski volumenya
            tidak berubah — porsinya mengecil karena pekerjaan lain bertambah.
          </p>
        </section>

        <SignatureBlock signatories={signatories} />
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
