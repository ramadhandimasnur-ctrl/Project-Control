import { Lock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
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
import { ActualCostLedger } from '@/features/costs/actual-cost-ledger';
import { canEditProjectData } from '@/lib/auth/roles';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { getCostControl, getPurchasedVsUsed, listActualCosts } from '@/services/costs';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';
import { listWorkItems } from '@/services/work-breakdown';

export const metadata: Metadata = { title: 'Kendali Biaya' };

/** A CPI reads as good, watch, or bad — the number alone makes people guess. */
function cpiTone(cpi: string | null): 'secondary' | 'outline' | 'destructive' {
  if (cpi === null) return 'outline';
  const value = Number(cpi);
  if (value >= 1) return 'secondary';
  return value >= 0.9 ? 'outline' : 'destructive';
}

export default async function CostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();
  const project = await getProject(user.id, projectId);

  const [control, purchased, ledger, workItems] = await Promise.all([
    getCostControl(user.id, projectId),
    getPurchasedVsUsed(user.id, projectId),
    listActualCosts(user.id, projectId),
    listWorkItems(user.id, projectId),
  ]);

  if (!control.showCosts) {
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

  const canEdit = canEditProjectData(project.role);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kendali Biaya"
        description="Biaya aktual dibandingkan dengan bagian rencana yang sudah dikerjakan, bukan dengan seluruh rencana. Pekerjaan yang belum mulai tidak dihitung sebagai penghematan."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: 'Total RAB', value: formatCurrency(control.totals.totalRab) },
          { label: 'Total RAP', value: formatCurrency(control.totals.totalRap) },
          { label: 'Biaya aktual', value: formatCurrency(control.totals.actual) },
          { label: 'Nilai dikerjakan', value: formatCurrency(control.totals.earned) },
          {
            label: 'CPI proyek',
            value: control.totals.cpi === null ? EMPTY_VALUE : Number(control.totals.cpi).toFixed(2),
          },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Biaya per item pekerjaan</h2>

        <div className="w-full rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Kode</TableHead>
                <TableHead className="min-w-48">Uraian</TableHead>
                <TableHead className="w-28 text-right">RAP</TableHead>
                <TableHead className="w-20 text-right">Selesai</TableHead>
                <TableHead className="w-28 text-right">Dikerjakan</TableHead>
                <TableHead className="w-28 text-right">Aktual</TableHead>
                <TableHead className="w-28 text-right">Selisih</TableHead>
                <TableHead className="w-20 text-right">CPI</TableHead>
                <TableHead className="w-28 text-right">Prakiraan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {control.rows.map((row) => (
                <TableRow key={row.workItemId}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.totalRap)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(row.completion, 1)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.earned)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.actual)}
                    {/*
                      Split by where it came from, because the two are corrected
                      in different places: an issue is fixed in the warehouse,
                      a booking is fixed in the ledger below.
                    */}
                    {row.actualIssued !== '0.00' && row.actualBooked !== '0.00' ? (
                      <span className="block text-[10px] text-muted-foreground">
                        gudang {formatCurrency(row.actualIssued)} · dicatat{' '}
                        {formatCurrency(row.actualBooked)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono tabular-nums ${
                      Number(row.variance) < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {formatCurrency(row.variance)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.cpi === null ? (
                      <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                    ) : (
                      <Badge variant={cpiTone(row.cpi)} className="font-mono tabular-nums">
                        {Number(row.cpi).toFixed(2)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {row.forecast === null ? EMPTY_VALUE : formatCurrency(row.forecast)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Jumlah</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatCurrency(control.totals.totalRap)}
                </TableCell>
                <TableCell />
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatCurrency(control.totals.earned)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatCurrency(control.totals.actual)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatCurrency(control.totals.variance)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          CPI adalah nilai dikerjakan dibagi biaya aktual. Di bawah 1 berarti pekerjaan itu memakan
          biaya lebih besar daripada nilai yang sudah dihasilkannya. Prakiraan memproyeksikan laju
          itu sampai pekerjaan selesai.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Beli vs terpasang</h2>

        {purchased.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Belum ada mutasi material pada proyek ini.
          </p>
        ) : (
          <div className="w-full rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead className="min-w-48">Sumber daya</TableHead>
                  <TableHead className="w-28 text-right">Dibeli</TableHead>
                  <TableHead className="w-28 text-right">Terpasang</TableHead>
                  <TableHead className="w-28 text-right">Sisa</TableHead>
                  <TableHead className="w-24 text-right">Terpakai</TableHead>
                  <TableHead className="w-28 text-right">Harga rata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchased.rows.map((row) => (
                  <TableRow key={row.resourceId}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.qtyIn)}
                      <span className="ml-1 text-xs text-muted-foreground">{row.unitCode}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.qtyOut)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.qtyRemaining)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.usedFraction === null ? EMPTY_VALUE : formatPercent(row.usedFraction, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.avgPriceIn === null ? EMPTY_VALUE : formatCurrency(row.avgPriceIn)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Selisihnya bukan kerugian dengan sendirinya — material yang sudah dibeli tapi belum
          terpasang adalah stok. Yang perlu ditanyakan adalah kalau selisih itu berhenti mengecil.
        </p>
      </section>

      <ActualCostLedger
        projectId={projectId}
        entries={ledger}
        workItems={workItems.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
        canEdit={canEdit}
      />
    </div>
  );
}
