import type { Metadata } from 'next';
import Link from 'next/link';

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
import {
  CostAccessNotice,
  Kpi,
  MissingPricesAlert,
  NoWorkItems,
} from '@/features/estimate/estimate-shell';
import { ZERO, toDecimal } from '@/lib/calc/decimal';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { getProjectEstimate, type ProjectEstimateItem } from '@/services/ahsp';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'RAP' };

/**
 * Rencana Anggaran Pelaksanaan — what the job costs to run.
 *
 * The contractor's own budget, and the two gaps that matter: RAB against RAP,
 * which is where the estimate expects to be beaten, and contract against RAP,
 * which is the margin. Deliberately a separate page from RAB — these figures
 * are internal, and the separation makes it obvious which sheet must never
 * leave the office.
 */
export default async function RapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const estimate = await getProjectEstimate(user.id, projectId);

  if (!estimate.showCosts) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="RAP" />
        <CostAccessNotice title="RAP" />
      </div>
    );
  }

  const { totals } = estimate;
  const spread = toDecimal(totals.totalRab).minus(totals.totalRap);
  const spreadPercent =
    toDecimal(totals.totalRab).isZero() ? null : spread.dividedBy(totals.totalRab);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="RAP — Rencana Anggaran Pelaksanaan"
        description="Anggaran internal untuk mengerjakan proyek, beserta selisihnya terhadap RAB dan margin terhadap nilai kontrak."
      />

      <MissingPricesAlert missing={estimate.missingPrices} />

      {estimate.items.length === 0 ? (
        <NoWorkItems description="Susun daftar pekerjaan dan analisanya terlebih dahulu; RAP terbentuk dari sana." />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Total RAP" value={totals.totalRap} />
            <Kpi label="Total RAB" value={totals.totalRab} />
            <Kpi
              label="Selisih RAB − RAP"
              value={spread.toString()}
              caption={spreadPercent === null ? EMPTY_VALUE : formatPercent(spreadPercent)}
              tone={spread.isNegative() ? 'negative' : 'default'}
            />
            <Kpi
              label="Margin"
              value={totals.margin}
              caption={
                totals.marginPercent === null ? EMPTY_VALUE : formatPercent(totals.marginPercent)
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
                  <TableHead className="w-32 text-right">HS RAP</TableHead>
                  <TableHead className="w-36 text-right">Total RAP</TableHead>
                  <TableHead className="w-36 text-right">Total RAB</TableHead>
                  <TableHead className="w-32 text-right">Selisih</TableHead>
                  <TableHead className="w-32 text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estimate.items.map((item) => {
                  const itemSpread = toDecimal(item.totalRab).minus(item.totalRap);

                  return (
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
                      </TableCell>
                      {/*
                        The volume this side is costed on, which is not always
                        the contracted one — swell, overbuild and temporary
                        works all make execution build more than was sold. The
                        contracted figure is flagged beneath when they differ,
                        because a reader comparing this table against the RAB
                        would otherwise take the gap for an error.
                      */}
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(item.volumeRap)}
                        {item.volumeRap === item.volume ? null : (
                          <span className="block text-[10px] text-muted-foreground">
                            RAB {formatQuantity(item.volume)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.unitCode}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(item.unitCostRap)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {formatCurrency(item.totalRap)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatCurrency(item.totalRab)}
                      </TableCell>
                      {/*
                        Negative means execution is planned to cost more than
                        the estimate it was drawn from — worth seeing in red
                        before the work starts rather than after.
                      */}
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          itemSpread.isNegative() ? 'text-destructive' : 'text-muted-foreground'
                        }`}
                      >
                        {formatCurrency(itemSpread.toString())}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          Number(item.margin) < 0 ? 'text-destructive' : ''
                        }`}
                      >
                        {formatCurrency(item.margin)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Jumlah</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(totals.totalRap)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(totals.totalRab)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(spread.toString())}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(sumMargin(estimate.items).toString())}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            RAP adalah anggaran pelaksanaan kontraktor sendiri. Angka pada halaman ini tidak pernah
            ikut pada laporan yang diterbitkan ke pemberi kerja.
          </p>
        </>
      )}
    </div>
  );
}

function sumMargin(items: readonly ProjectEstimateItem[]) {
  return items.reduce((acc, item) => acc.plus(toDecimal(item.margin)), ZERO);
}
