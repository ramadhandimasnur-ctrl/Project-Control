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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CapitalSimulator } from '@/features/cash/capital-simulator';
import { canViewCosts } from '@/lib/auth/roles';
import { CASH_CATEGORY_LABELS, VARIANCE_STATUS_LABELS } from '@/lib/calc/cashflow';
import { PERFORMANCE_LABELS, type PerformanceVerdict } from '@/lib/calc/earned-value';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatRatio } from '@/lib/format';
import { getCapitalPlan, getCashflow, getFinancialSummary } from '@/services/cash';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kebutuhan Modal' };

const STATUS_TONE = {
  UNDER: 'text-primary',
  ON_BUDGET: 'text-foreground',
  OVER: 'text-destructive',
} as const;

/** Unmeasured stays neutral — grey is honest, green would be a claim. */
const VERDICT_TONE: Record<PerformanceVerdict, string | undefined> = {
  GOOD: 'text-primary',
  WATCH: undefined,
  BAD: 'text-destructive',
  UNKNOWN: 'text-muted-foreground',
};

/**
 * RAB against RAP against what was actually spent, plus how much cash the
 * project has to carry before the owner pays.
 */
export default async function CapitalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ target?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
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

  /*
   * The default target is the next round quarter above where the project
   * already stands, because a simulation that opens on "reach 0%" answers a
   * question nobody has.
   */
  const parsedTarget = Number(query.target);
  const explicitTarget =
    Number.isFinite(parsedTarget) && query.target !== undefined
      ? Math.min(Math.max(parsedTarget, 0), 100)
      : null;

  const [summary, cashflow] = await Promise.all([
    getFinancialSummary(user.id, projectId),
    getCashflow(user.id, projectId),
  ]);

  const currentPct = Number(summary.completionPct) * 100;
  // floor, not ceil: a project sitting exactly on 50% wants 75% next, and a
  // project at 27% wants 50% — ceil would skip a whole quarter in one case.
  const targetPct = explicitTarget ?? Math.min(Math.floor(currentPct / 25) * 25 + 25, 100);
  const plan = await getCapitalPlan(user.id, projectId, String(targetPct / 100));

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

      {/*
        EVA splits the two ways a project goes wrong. "We have spent 60% of the
        budget" hides both; SPI says whether the work is late and CPI says
        whether it is expensive, and the pair is what makes the answer
        actionable rather than merely alarming.
      */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Earned Value Analysis</h2>
        <p className="text-xs text-muted-foreground">
          Diukur terhadap RAP sebagai anggaran akhir (BAC), karena realisasi biaya adalah uang yang
          benar-benar keluar. Membandingkannya dengan nilai kontrak akan membuat CPI memuji setiap
          proyek.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Figure
            label="Planned Value (PV)"
            value={formatCurrency(plan.earnedValue.pv)}
            caption={`Rencana ${formatPercent(plan.plannedCumulative, 2)} × RAP`}
          />
          <Figure
            label="Earned Value (EV)"
            value={formatCurrency(plan.earnedValue.ev)}
            caption={`Realisasi ${formatPercent(plan.actualCumulative, 2)} × RAP`}
          />
          <Figure
            label="Actual Cost (AC)"
            value={formatCurrency(plan.earnedValue.ac)}
            caption="Dari buku kas"
          />
          <Figure
            label="Indeks biaya (CPI)"
            value={plan.earnedValue.cpi === null ? EMPTY_VALUE : formatRatio(plan.earnedValue.cpi)}
            caption={`EV ÷ AC · ${PERFORMANCE_LABELS[plan.costVerdict]}`}
            tone={VERDICT_TONE[plan.costVerdict]}
          />
          <Figure
            label="Indeks jadwal (SPI)"
            value={plan.earnedValue.spi === null ? EMPTY_VALUE : formatRatio(plan.earnedValue.spi)}
            caption={`EV ÷ PV · ${PERFORMANCE_LABELS[plan.scheduleVerdict]}`}
            tone={VERDICT_TONE[plan.scheduleVerdict]}
          />
          <Figure
            label="Varians biaya & jadwal"
            value={formatCurrency(plan.earnedValue.cv)}
            caption={`CV · jadwal ${formatCurrency(plan.earnedValue.sv)}`}
            tone={Number(plan.earnedValue.cv) < 0 ? 'text-destructive' : undefined}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Perkiraan biaya akhir (EAC)"
            value={
              plan.earnedValue.eac === null ? EMPTY_VALUE : formatCurrency(plan.earnedValue.eac)
            }
            caption="BAC ÷ CPI"
          />
          <Figure
            label="Sisa yang harus dikeluarkan (ETC)"
            value={
              plan.earnedValue.etc === null ? EMPTY_VALUE : formatCurrency(plan.earnedValue.etc)
            }
            caption="EAC − AC"
          />
          <Figure
            label="Varians akhir (VAC)"
            value={
              plan.earnedValue.vac === null ? EMPTY_VALUE : formatCurrency(plan.earnedValue.vac)
            }
            caption="BAC − EAC"
            tone={
              plan.earnedValue.vac !== null && Number(plan.earnedValue.vac) < 0
                ? 'text-destructive'
                : undefined
            }
          />
        </div>

        <p className="text-xs text-muted-foreground">
          EAC memakai kecenderungan biaya sejauh ini: ia mengandaikan sisa proyek berperilaku sama
          dengan bagian yang sudah dikerjakan. Itu proyeksi, bukan komitmen.
        </p>
      </section>

      {/* Simulation: what the next stretch of progress costs to buy. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Simulasi kebutuhan biaya per target progres</h2>
          <p className="text-xs text-muted-foreground">
            Masukkan target bobot progres, dan daftar di bawah menunjukkan pekerjaan apa saja yang
            harus diselesaikan untuk sampai ke sana beserta biayanya menurut RAB dan RAP.
          </p>
        </div>

        <div className="rounded-lg border p-3">
          <CapitalSimulator
            projectId={projectId}
            currentTarget={targetPct}
            currentWeight={currentPct}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Progres sekarang"
            value={formatPercent(plan.simulation.currentWeight, 2)}
            caption="Disetujui"
          />
          <Figure
            label="Kekurangan menuju target"
            value={formatPercent(plan.simulation.gap, 2)}
            caption={`Target ${formatPercent(plan.simulation.targetWeight, 2)}`}
          />
          <Figure
            label="Biaya menurut RAP"
            value={formatCurrency(plan.simulation.totalRap)}
            caption="Anggaran pelaksanaan"
          />
          <Figure
            label="Biaya menurut RAB"
            value={formatCurrency(plan.simulation.totalRab)}
            caption="Anggaran biaya"
          />
        </div>

        {!plan.simulation.achievable ? (
          <Alert variant="destructive">
            <Info className="size-4" aria-hidden />
            <AlertTitle>Target ini tidak tercapai oleh daftar pekerjaan yang ada</AlertTitle>
            <AlertDescription>
              Menyelesaikan seluruh pekerjaan berbobot hanya mencapai{' '}
              {formatPercent(plan.simulation.reachableWeight, 2)}. Periksa apakah masih ada
              pekerjaan yang belum masuk daftar, atau ada yang tidak diikutkan dalam bobot progres.
            </AlertDescription>
          </Alert>
        ) : null}

        {plan.simulation.rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Target ini sudah tercapai oleh progres yang disetujui — tidak ada pekerjaan yang perlu
            ditambahkan.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead>Uraian</TableHead>
                  <TableHead className="w-24 text-right">Bobot</TableHead>
                  <TableHead className="w-24 text-right">Sudah</TableHead>
                  <TableHead className="w-28 text-right">Perlu dikerjakan</TableHead>
                  <TableHead className="w-28 text-right">Tambahan bobot</TableHead>
                  <TableHead className="w-36 text-right">Biaya RAP</TableHead>
                  <TableHead className="w-36 text-right">Biaya RAB</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.simulation.rows.map((row) => (
                  <TableRow key={row.workItemId}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>
                      {row.name}
                      {row.isPartial ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          sebagian
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(row.weight, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(row.completed, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(row.requiredFraction, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(row.weightGained, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {formatCurrency(row.costRap)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatCurrency(row.costRab)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Jumlah</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(plan.simulation.gap, 2)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(plan.simulation.totalRap)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(plan.simulation.totalRab)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Urutannya mengikuti rencana jadwal, bukan pekerjaan termurah yang kebetulan berbobot sama.
          Pekerjaan yang hanya perlu sebagian dihitung biayanya secara proporsional terhadap porsi
          yang dikerjakan.
        </p>
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
