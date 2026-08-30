import { FileText, Lock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PeriodPicker } from '@/features/progress/period-picker';
import { EMPTY_VALUE, formatCurrency, formatDay, formatQuantity } from '@/lib/format';
import { getProject } from '@/services/projects';
import { getRapReport, type RapReportSection } from '@/services/rap-report';
import { listPeriods } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Laporan RAP' };

/**
 * The operational report, laid out to be printed.
 *
 * Everything that is navigation rather than content carries `data-print="hide"`
 * and disappears on paper, so the page read on screen and the page handed over
 * are the same page.
 */
function Section({ section }: { section: RapReportSection }) {
  return (
    <section className="space-y-2" data-print="keep-together">
      <h2 className="text-sm font-semibold">{section.label}</h2>

      {section.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Tidak ada catatan pada periode ini.
        </p>
      ) : (
        <div className="w-full rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Rujukan</TableHead>
                <TableHead className="min-w-48">Uraian</TableHead>
                <TableHead className="w-32 text-right">Jumlah</TableHead>
                <TableHead className="w-36 text-right">Nilai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.map((row, index) => (
                <TableRow key={`${row.reference}-${index}`}>
                  <TableCell className="font-mono text-xs">{row.reference}</TableCell>
                  <TableCell>{row.description}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.qty === null ? (
                      EMPTY_VALUE
                    ) : (
                      <>
                        {formatQuantity(row.qty)}
                        <span className="ml-1 text-xs text-muted-foreground">{row.unitCode}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>Jumlah</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatCurrency(section.total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  );
}

export default async function RapReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();

  const [project, periods] = await Promise.all([
    getProject(user.id, projectId),
    listPeriods(user.id, projectId),
  ]);

  const periodId = query.period ?? periods[0]?.id;

  if (periodId === undefined) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FileText}
          title="Belum ada periode"
          description="Susun periode pelaporan di Periode & Jadwal terlebih dahulu."
        />
      </div>
    );
  }

  const report = await getRapReport(user.id, projectId, periodId);

  if (!report.showCosts) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Lock}
          title="Halaman ini memuat angka biaya"
          description="Peran Anda pada proyek ini tidak diberi akses ke harga, biaya, dan margin."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div data-print="hide">
        <PageHeader
          title="Laporan RAP"
          description="Laporan operasional untuk dapur sendiri: ke mana uang periode ini pergi, dipilah menurut cara uang benar-benar dibelanjakan. Berbeda dari opname, yang merupakan dokumen kontrak terhadap RAB."
        />
      </div>

      <div data-print="hide">
        <PeriodPicker
          basePath={`/projects/${projectId}/reports/rap`}
          periods={periods}
          selectedId={periodId}
        />
      </div>

      <header className="space-y-1 border-b pb-3">
        <h1 className="text-lg font-semibold">Laporan RAP — {project.name}</h1>
        <p className="text-sm text-muted-foreground">
          {report.period.label} · {formatDay(report.period.startDate)} –{' '}
          {formatDay(report.period.endDate)}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Nilai dikerjakan (RAP)', value: report.totals.earnedThisPeriod },
          { label: 'Dibelanjakan', value: report.totals.spentThisPeriod },
          { label: 'Selisih', value: report.totals.variance },
          {
            label: 'Rasio',
            value:
              report.totals.ratio === null
                ? EMPTY_VALUE
                : Number(report.totals.ratio).toFixed(2),
            raw: true,
          },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p
              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                card.label === 'Selisih' && Number(card.value) < 0 ? 'text-destructive' : ''
              }`}
            >
              {card.raw === true ? card.value : formatCurrency(card.value)}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {report.progress.itemsWorked} pekerjaan mendapat progres yang disetujui pada periode ini.
      </p>

      <Section section={report.material} />
      <Section section={report.subcontract} />
      <Section section={report.booked} />
      <Section section={report.advances} />

      <p className="text-xs text-muted-foreground">
        Kasbon dicantumkan tetapi tidak ikut dijumlahkan sebagai biaya. Ia uang yang berpindah ke
        mandor sebelum ada yang diukur, dan baru menjadi biaya ketika sertifikat menyatakannya —
        menghitungnya dua kali akan membuat periode ini tampak jauh lebih mahal daripada
        sebenarnya.
      </p>
    </div>
  );
}
