import { ArrowRight, TriangleAlert } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { CashflowChart } from '@/features/cash/cashflow-chart';
import { SCurveChart } from '@/features/schedule/scurve-chart';
import { canViewCosts } from '@/lib/auth/roles';
import { VARIANCE_STATUS_LABELS } from '@/lib/calc/cashflow';
import { PROGRESS_STATUS_LABELS } from '@/lib/calc/progress';
import { EMPTY_VALUE, formatCurrency, formatDay, formatPercent, formatRatio } from '@/lib/format';
import { getExecutiveSummary } from '@/services/cash';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

/**
 * Executive dashboard.
 *
 * One screen answering the three questions a project owner actually asks: is it
 * on time, will it make money, and can it pay its bills next month. Everything
 * here is read through `getExecutiveSummary`, which assembles the same figures
 * the detail pages show — a dashboard with its own arithmetic is a dashboard
 * that eventually disagrees with the pages it summarises.
 */

const PROGRESS_TONE = {
  AHEAD: 'text-primary',
  ON_TRACK: 'text-foreground',
  WARNING: 'text-amber-600 dark:text-amber-500',
  DELAYED: 'text-destructive',
} as const;

const VARIANCE_TONE = {
  UNDER: 'text-primary',
  ON_BUDGET: 'text-foreground',
  OVER: 'text-destructive',
} as const;

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const showCosts = canViewCosts(project.role);
  const summary = await getExecutiveSummary(user.id, projectId);

  const { progress, cash, financial, schedule } = summary;

  const lastReported = progress.points.filter((point) => point.spi !== null).at(-1)?.seq ?? null;
  const curve = schedule.curve.map((point) => ({
    ...point,
    actualCumulative:
      lastReported !== null && point.seq <= lastReported
        ? (progress.points.find((p) => p.periodId === point.periodId)?.actualCumulative.toString() ??
          null)
        : null,
  }));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={project.name}
        description={`${project.code}${project.location ? ` · ${project.location}` : ''} · ${formatDay(project.startDate)} – ${formatDay(project.endDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <ButtonLink variant="outline" href={`/projects/${projectId}/progress`}>
              Input Progres
            </ButtonLink>
            <ButtonLink href={`/projects/${projectId}/scurve`}>
              Kurva-S
              <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </div>
        }
      />

      {/* --- physical health --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Kesehatan fisik</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Realisasi kumulatif"
            value={formatPercent(progress.current.actualCumulative, 2)}
            caption={
              progress.current.periodLabel
                ? `Sampai ${progress.current.periodLabel}`
                : 'Belum ada progres disetujui'
            }
          />
          <Figure
            label="Rencana kumulatif"
            value={formatPercent(progress.current.plannedCumulative, 2)}
            caption={progress.curveFromBaseline ? 'Dari baseline' : 'Dari rencana draf'}
          />
          <Figure
            label="Deviasi jadwal"
            value={formatPercent(progress.current.deviation, 2)}
            caption={PROGRESS_STATUS_LABELS[progress.current.status]}
            tone={PROGRESS_TONE[progress.current.status]}
          />
          <Figure
            label="Indeks jadwal (SPI)"
            value={progress.current.spi === null ? EMPTY_VALUE : formatRatio(progress.current.spi)}
            caption={
              progress.current.spi === null
                ? 'Belum ada laporan'
                : Number(progress.current.spi) >= 1
                  ? 'Sesuai atau lebih cepat'
                  : 'Lebih lambat dari rencana'
            }
          />
        </dl>
      </section>

      {!progress.curveFromBaseline && progress.hasPlan ? (
        <Alert>
          <TriangleAlert className="size-4" aria-hidden />
          <AlertTitle>Deviasi diukur terhadap rencana yang masih berubah</AlertTitle>
          <AlertDescription>
            Proyek ini belum punya baseline aktif, sehingga acuannya bergeser setiap kali
            distribusi rencana disunting.{' '}
            <ButtonLink
              variant="link"
              size="sm"
              href={`/projects/${projectId}/schedule`}
              className="h-auto p-0"
            >
              Kunci baseline
            </ButtonLink>{' '}
            agar penyimpangan ini punya arti.
          </AlertDescription>
        </Alert>
      ) : null}

      {progress.hasPlan ? (
        <SCurveChart curve={curve} />
      ) : (
        <Alert>
          <AlertTitle>Kurva-S belum dapat digambar</AlertTitle>
          <AlertDescription>
            Bangun periode dan sebarkan bobot pekerjaan di{' '}
            <ButtonLink
              variant="link"
              size="sm"
              href={`/projects/${projectId}/schedule`}
              className="h-auto p-0"
            >
              Periode &amp; Jadwal
            </ButtonLink>
            .
          </AlertDescription>
        </Alert>
      )}

      {/* --- money --- */}
      {showCosts ? (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Kesehatan finansial</h2>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Figure
                label="Nilai kontrak"
                value={formatCurrency(financial.contractValue)}
                caption={`RAP ${formatCurrency(financial.totalRap)}`}
              />
              <Figure
                label="Realisasi biaya"
                value={formatCurrency(financial.actualCost)}
                caption={`Nilai jadi ${formatCurrency(financial.variance.earned)}`}
              />
              <Figure
                label="Varians biaya"
                value={formatCurrency(financial.variance.costVariance)}
                caption={VARIANCE_STATUS_LABELS[financial.variance.status]}
                tone={VARIANCE_TONE[financial.variance.status]}
              />
              <Figure
                label="Margin proyeksi"
                value={formatCurrency(financial.margin.projected)}
                caption={
                  financial.margin.projectedPercent === null
                    ? `Rencana ${formatCurrency(financial.margin.planned)}`
                    : `${formatPercent(financial.margin.projectedPercent, 2)} · rencana ${formatCurrency(financial.margin.planned)}`
                }
                tone={Number(financial.margin.projected) < 0 ? 'text-destructive' : undefined}
              />
            </dl>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Kesehatan kas</h2>
              <div className="flex items-center gap-2">
                {cash.peak ? (
                  <Badge variant="destructive" className="text-[10px]">
                    perlu talangan {formatCurrency(cash.peak.shortfall)}
                  </Badge>
                ) : cash.hasPeriods ? (
                  <Badge variant="secondary" className="text-[10px]">
                    tidak pernah defisit
                  </Badge>
                ) : null}
                <ButtonLink variant="outline" size="sm" href={`/projects/${projectId}/cash`}>
                  Kas &amp; Termin
                </ButtonLink>
              </div>
            </div>

            {cash.hasPeriods ? (
              <>
                {cash.deficits.length > 0 ? (
                  <Alert variant="destructive">
                    <TriangleAlert className="size-4" aria-hidden />
                    <AlertTitle>
                      Kas minus pada {cash.deficits.length} periode, terdalam di{' '}
                      {cash.peak?.label}
                    </AlertTitle>
                    <AlertDescription>
                      Sediakan {formatCurrency(cash.peak?.shortfall ?? 0)}, atau majukan penagihan
                      termin sebelum periode itu.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <CashflowChart
                  flow={cash.flow.map((point) => ({
                    label: point.label,
                    inflow: point.inflow,
                    outflow: point.outflow,
                    closing: point.closing,
                    isDeficit: point.isDeficit,
                  }))}
                />
              </>
            ) : (
              <Alert>
                <AlertTitle>Arus kas menunggu kalender periode</AlertTitle>
                <AlertDescription>
                  Transaksi dikelompokkan per periode proyek sebelum dapat digambar.
                </AlertDescription>
              </Alert>
            )}
          </section>
        </>
      ) : (
        <Alert>
          <AlertTitle>Angka biaya disembunyikan untuk peran Anda</AlertTitle>
          <AlertDescription>
            Ringkasan fisik di atas tetap tersedia. Harga, biaya, dan margin tidak dikirim ke
            peramban untuk peran lapangan.
          </AlertDescription>
        </Alert>
      )}

      {/* --- exports --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Laporan</h2>
        <div className="flex flex-wrap gap-2">
          <ButtonLink variant="outline" href={`/projects/${projectId}/reports/opname`}>
            Laporan opname (cetak)
          </ButtonLink>
          <ExportLink projectId={projectId} report="progress" label="Rekap progres (Excel)" />
          {showCosts ? (
            <>
              <ExportLink projectId={projectId} report="cashflow" label="Arus kas (Excel)" />
              <ExportLink projectId={projectId} report="finance" label="RAB/RAP/Realisasi (Excel)" />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * A plain anchor, not a client component.
 *
 * The export is a normal GET that answers with a file; routing it through
 * JavaScript would only add a way for it to fail.
 */
function ExportLink({
  projectId,
  report,
  label,
}: {
  projectId: string;
  report: string;
  label: string;
}) {
  return (
    <ButtonLink variant="outline" href={`/projects/${projectId}/exports/${report}`}>
      {label}
    </ButtonLink>
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
