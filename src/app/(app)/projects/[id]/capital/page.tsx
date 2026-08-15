import { FileSpreadsheet, Info, Scale } from 'lucide-react';
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
import { canViewCosts } from '@/lib/auth/roles';
import { CASH_CATEGORY_LABELS, VARIANCE_STATUS_LABELS } from '@/lib/calc/cashflow';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatRatio } from '@/lib/format';
import { getCashflow, getFinancialSummary } from '@/services/cash';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kebutuhan Modal' };

const STATUS_TONE = {
  UNDER: 'text-primary',
  ON_BUDGET: 'text-foreground',
  OVER: 'text-destructive',
} as const;

/**
 * RAB against RAP against what was actually spent, plus how much cash the
 * project has to carry before the owner pays.
 */
export default async function CapitalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);

  if (!canViewCosts(project.role)) {
    return (
      <div className="space-y-6 p-6">
        <EmptyState
          icon={Scale}
          title="Halaman ini memuat angka biaya"
          description="Peran Anda pada proyek ini tidak diberi akses ke harga, biaya, dan margin."
        />
      </div>
    );
  }

  const [summary, cashflow] = await Promise.all([
    getFinancialSummary(user.id, projectId),
    getCashflow(user.id, projectId),
  ]);

  const spentPct =
    Number(summary.totalRap) === 0 ? null : Number(summary.actualCost) / Number(summary.totalRap);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kebutuhan Modal & Evaluasi Biaya"
        description="RAB adalah yang dijual, RAP yang direncanakan, realisasi yang benar-benar keluar. Selisihnya diukur terhadap pekerjaan yang sudah jadi."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink variant="outline" href={`/projects/${projectId}/exports/finance`}>
              <FileSpreadsheet className="size-4" aria-hidden />
              Ekspor Excel
            </ButtonLink>
            <ButtonLink variant="outline" href={`/projects/${projectId}/cash`}>
              Kas &amp; Termin
            </ButtonLink>
          </div>
        }
      />

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Nilai kontrak" value={formatCurrency(summary.contractValue)} />
        <Figure label="RAB" value={formatCurrency(summary.totalRab)} caption="Anggaran biaya" />
        <Figure label="RAP" value={formatCurrency(summary.totalRap)} caption="Anggaran pelaksanaan" />
        <Figure
          label="Realisasi biaya"
          value={formatCurrency(summary.actualCost)}
          caption={
            spentPct === null ? undefined : `${formatPercent(spentPct, 1)} dari RAP terpakai`
          }
        />
      </dl>

      {Number(summary.actualCost) === 0 ? (
        <Alert>
          <Info className="size-4" aria-hidden />
          <AlertTitle>Belum ada biaya yang tercatat</AlertTitle>
          <AlertDescription>
            Realisasi biaya dibaca dari buku kas — pembelian yang sudah di-POST dan pengeluaran
            manual. Selama belum ada yang keluar, varians dan proyeksi belum bermakna.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Varians biaya</h2>
        <p className="text-xs text-muted-foreground">
          Dibandingkan terhadap nilai pekerjaan yang sudah selesai, bukan terhadap seluruh
          anggaran. Menghabiskan 40% anggaran itu wajar pada progres 40% dan mengkhawatirkan pada
          15%.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Progres fisik"
            value={formatPercent(summary.completionPct, 2)}
            caption="Realisasi disetujui"
          />
          <Figure
            label="Nilai pekerjaan jadi"
            value={formatCurrency(summary.variance.earned)}
            caption="RAP × progres"
          />
          <Figure
            label="Varians"
            value={formatCurrency(summary.variance.costVariance)}
            caption={VARIANCE_STATUS_LABELS[summary.variance.status]}
            tone={STATUS_TONE[summary.variance.status]}
          />
          <Figure
            label="Indeks biaya (CPI)"
            value={summary.variance.cpi === null ? EMPTY_VALUE : formatRatio(summary.variance.cpi)}
            caption={
              summary.variance.cpi === null
                ? 'Belum ada belanja'
                : Number(summary.variance.cpi) >= 1
                  ? 'Tiap rupiah menghasilkan lebih'
                  : 'Tiap rupiah menghasilkan kurang'
            }
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Proyeksi akhir proyek</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Perkiraan biaya akhir"
            value={
              summary.variance.estimateAtCompletion === null
                ? EMPTY_VALUE
                : formatCurrency(summary.variance.estimateAtCompletion)
            }
            caption="RAP pada efisiensi saat ini"
          />
          <Figure
            label="Margin rencana"
            value={formatCurrency(summary.margin.planned)}
            caption="RAB − RAP"
          />
          <Figure
            label="Margin proyeksi"
            value={formatCurrency(summary.margin.projected)}
            caption={
              summary.margin.projectedPercent === null
                ? undefined
                : formatPercent(summary.margin.projectedPercent, 2)
            }
            tone={Number(summary.margin.projected) < 0 ? 'text-destructive' : undefined}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Realisasi biaya per kategori</h2>
        {summary.byCategory.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Belum ada pengeluaran tercatat.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="w-40 text-right">Nilai</TableHead>
                  <TableHead className="w-32 text-right">Porsi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byCategory
                  .slice()
                  .sort((a, b) => Number(b.amount) - Number(a.amount))
                  .map((row) => (
                    <TableRow key={row.category}>
                      <TableCell>
                        {CASH_CATEGORY_LABELS[row.category as keyof typeof CASH_CATEGORY_LABELS] ??
                          row.category}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(row.amount)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {Number(summary.actualCost) === 0
                          ? EMPTY_VALUE
                          : formatPercent(Number(row.amount) / Number(summary.actualCost), 1)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Kebutuhan modal</h2>
        {!cashflow.hasPeriods ? (
          <Alert>
            <AlertTitle>Menunggu kalender periode</AlertTitle>
            <AlertDescription>
              Kebutuhan modal dihitung dari saldo kas per periode.{' '}
              <ButtonLink
                variant="link"
                size="sm"
                href={`/projects/${projectId}/schedule`}
                className="h-auto p-0"
              >
                Bangun periode
              </ButtonLink>{' '}
              terlebih dahulu.
            </AlertDescription>
          </Alert>
        ) : cashflow.peak === null ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Saldo kas tidak pernah minus sepanjang proyek. Tidak ada dana talangan yang dibutuhkan.
          </p>
        ) : (
          <>
            <Alert variant="destructive">
              <AlertTitle>
                Dana talangan yang perlu disiapkan {formatCurrency(cashflow.peak.shortfall)}
              </AlertTitle>
              <AlertDescription>
                Titik terdalam terjadi pada {cashflow.peak.label}. Angka ini adalah selisih terbesar
                antara pengeluaran yang harus jalan lebih dulu dan penerimaan termin yang menyusul.
              </AlertDescription>
            </Alert>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periode</TableHead>
                    <TableHead className="w-40 text-right">Saldo akhir</TableHead>
                    <TableHead className="w-32">Keterangan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashflow.flow
                    .filter((point) => point.isDeficit)
                    .map((point) => (
                      <TableRow key={point.periodId}>
                        <TableCell>{point.label}</TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums text-destructive">
                          {formatCurrency(point.closing)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="text-[10px]">
                            defisit
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: string;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
      {caption ? <p className={`text-xs ${tone ?? 'text-muted-foreground'}`}>{caption}</p> : null}
    </div>
  );
}
