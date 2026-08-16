import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  CostAccessNotice,
  Kpi,
  MissingPricesAlert,
  NoWorkItems,
  WEIGHT_BASIS_LABELS,
} from '@/features/estimate/estimate-shell';
import { formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { getProjectEstimate } from '@/services/ahsp';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'RAB' };

/**
 * Rencana Anggaran Biaya — what the job is worth.
 *
 * The revenue side: the contract price per work item, the internal RAB estimate
 * that checks it, and the weight each item carries. Execution cost lives on the
 * RAP page, because mixing the two on one sheet is how a contract figure ends
 * up being read as a cost figure.
 */
export default async function RabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const [project, estimate] = await Promise.all([
    getProject(user.id, projectId),
    getProjectEstimate(user.id, projectId),
  ]);

  if (!estimate.showCosts) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="RAB" />
        <CostAccessNotice title="RAB" />
      </div>
    );
  }

  const { totals, reconciliation } = estimate;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="RAB — Rencana Anggaran Biaya"
        description={`Nilai pekerjaan dan bobotnya. Bobot progres dihitung atas dasar ${WEIGHT_BASIS_LABELS[estimate.weightBasis]}.`}
      />

      {/* Design decision 1: the gap is shown with its figures, never absorbed. */}
      {reconciliation.needsAttention ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>Nilai kontrak proyek tidak cocok dengan jumlah pekerjaannya</AlertTitle>
          <AlertDescription>
            <p>
              Jumlah nilai kontrak seluruh pekerjaan{' '}
              <strong>{formatCurrency(reconciliation.sumOfWorkItemContractValues)}</strong>,
              sedangkan nilai kontrak proyek{' '}
              <strong>{formatCurrency(reconciliation.declaredContractValue)}</strong> — selisih{' '}
              <strong>{formatCurrency(reconciliation.difference)}</strong>
              {reconciliation.differencePercent === null
                ? ''
                : ` (${formatPercent(reconciliation.differencePercent)})`}
              .
            </p>
            <p className="mt-2">
              Selisih ini tidak disesuaikan otomatis. Perbaiki harga satuan kontrak pada pekerjaan
              yang keliru, atau perbarui nilai kontrak proyek di Pengaturan.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <MissingPricesAlert missing={estimate.missingPrices} />

      {estimate.items.length === 0 ? (
        <NoWorkItems description="Susun daftar pekerjaan dan analisanya terlebih dahulu; RAB terbentuk dari sana." />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi label="Total RAB" value={totals.totalRab} />
            <Kpi label="Nilai kontrak" value={totals.contractValue} />
            <Kpi
              label="Nilai kontrak proyek"
              value={project.contractValue}
              caption="menurut Pengaturan"
            />
          </dl>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead>Uraian</TableHead>
                  <TableHead className="w-24 text-right">Volume</TableHead>
                  <TableHead className="w-16">Sat</TableHead>
                  <TableHead className="w-32 text-right">HS RAB</TableHead>
                  <TableHead className="w-36 text-right">Total RAB</TableHead>
                  <TableHead className="w-36 text-right">Nilai kontrak</TableHead>
                  <TableHead className="w-20 text-right">Bobot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estimate.items.map((item) => (
                  <TableRow key={item.workItemId}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/projects/${projectId}/work-items?item=${item.workItemId}`}
                        className="hover:underline"
                      >
                        {item.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${projectId}/work-items?item=${item.workItemId}`}
                        className="font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                      {item.lineCount === 0 ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          belum ada analisa
                        </Badge>
                      ) : null}
                      {!item.includeInProgressWeight ? (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          di luar bobot
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(item.volume)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.unitCode}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(item.unitCostRab)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(item.totalRab)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {formatCurrency(item.contractValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(item.weight)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Jumlah</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(totals.totalRab)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(totals.contractValue)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(1)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Harga satuan kontrak per pekerjaan adalah otoritas pendapatan. Pekerjaan yang belum
            punya harga kontrak memakai RAB dikali markup proyek sebagai nilai sementara, sehingga
            angkanya tetap terbentuk tanpa mengarang harga. Margin dan biaya pelaksanaan ada di
            halaman RAP.
          </p>
        </>
      )}
    </div>
  );
}
