import { AlertTriangle, FileBarChart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { getProjectEstimate } from '@/services/ahsp';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'RAB & RAP' };

const BASIS_LABELS = {
  CONTRACT: 'nilai kontrak',
  RAB: 'RAB',
  RAP: 'RAP',
} as const;

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const [project, estimate] = await Promise.all([
    getProject(user.id, projectId),
    getProjectEstimate(user.id, projectId),
  ]);

  if (!estimate.showCosts) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="RAB & RAP" />
        <Alert>
          <AlertTitle>Halaman ini menampilkan biaya dan margin</AlertTitle>
          <AlertDescription>
            Peran Anda pada proyek ini tidak mencakup akses ke angka biaya.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { totals, reconciliation } = estimate;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="RAB & RAP"
        description={`Bobot progres dihitung atas dasar ${BASIS_LABELS[estimate.weightBasis]}.`}
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

      {estimate.missingPrices.length > 0 ? (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>
            {estimate.missingPrices.length} harga belum diisi, total di bawah belum lengkap
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-inside list-disc">
              {estimate.missingPrices.slice(0, 10).map((m) => (
                <li key={`${m.resourceId}-${m.priceType}`}>
                  Harga {m.priceType} untuk &ldquo;{m.name}&rdquo; ({m.code})
                </li>
              ))}
            </ul>
            {estimate.missingPrices.length > 10 ? (
              <p className="mt-1">…dan {estimate.missingPrices.length - 10} lainnya.</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {estimate.items.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="Belum ada pekerjaan"
          description="Susun daftar pekerjaan dan analisanya terlebih dahulu; RAB dan RAP terbentuk dari sana."
        />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Total RAB" value={totals.totalRab} />
            <Kpi label="Total RAP" value={totals.totalRap} />
            <Kpi label="Nilai kontrak" value={totals.contractValue} />
            <Kpi
              label="Margin"
              value={totals.margin}
              caption={
                totals.marginPercent === null
                  ? EMPTY_VALUE
                  : formatPercent(totals.marginPercent)
              }
              tone={Number(totals.margin) < 0 ? 'negative' : 'default'}
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
                  <TableHead className="w-32 text-right">HS RAP</TableHead>
                  <TableHead className="w-36 text-right">Total RAP</TableHead>
                  <TableHead className="w-36 text-right">Nilai kontrak</TableHead>
                  <TableHead className="w-32 text-right">Margin</TableHead>
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
                      {formatCurrency(item.unitCostRap)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(item.totalRap)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(item.contractValue)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        Number(item.margin) < 0 ? 'text-destructive' : ''
                      }`}
                    >
                      {formatCurrency(item.margin)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatPercent(item.weight)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Nilai kontrak proyek menurut Pengaturan:{' '}
            {formatCurrency(project.contractValue)}. Harga satuan kontrak per pekerjaan adalah
            otoritas pendapatan; RAB dari susunan sumber daya adalah estimasi internal untuk
            memeriksa margin.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  caption,
  tone = 'default',
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'default' | 'negative';
}) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
          tone === 'negative' ? 'text-destructive' : ''
        }`}
      >
        {formatCurrency(value)}
      </dd>
      {caption ? <dd className="text-xs text-muted-foreground">{caption}</dd> : null}
    </div>
  );
}
