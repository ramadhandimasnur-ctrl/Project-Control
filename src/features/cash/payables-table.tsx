import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency, formatDay } from '@/lib/format';
import type { PayableRow, PayablesSummary } from '@/services/payables';

/**
 * Everything the project owes, in one list.
 *
 * The obligations were always there — a posted purchase, an approved
 * certificate — but on separate screens, so the question a cash forecast
 * starts from could not be asked: what falls due next month, across all of it.
 */

const BUCKET: Record<
  PayableRow['bucket'],
  { label: string; variant: 'destructive' | 'outline' | 'secondary' }
> = {
  OVERDUE: { label: 'lewat jatuh tempo', variant: 'destructive' },
  DUE_SOON: { label: '30 hari ke depan', variant: 'outline' },
  SCHEDULED: { label: 'terjadwal', variant: 'secondary' },
  UNDATED: { label: 'tanpa tempo', variant: 'outline' },
  PAID: { label: 'lunas', variant: 'secondary' },
};

const SOURCE_LABELS = { PURCHASE: 'Pembelian', SUBCONTRACT: 'Subkon' } as const;

export function PayablesTable({ payables }: { payables: PayablesSummary }) {
  if (!payables.showCosts) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Kewajiban</h2>
        <p className="text-xs text-muted-foreground">
          Pembelian yang sudah diposting dan sertifikat subkon yang sudah disetujui. Dokumen yang
          masih draf tidak dihitung — pesanan yang belum jadi bukan hutang.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Belum dibayar', value: payables.totals.outstanding },
          { label: 'Lewat jatuh tempo', value: payables.totals.overdue },
          { label: '30 hari ke depan', value: payables.totals.dueWithin30 },
          { label: 'Sudah dibayar', value: payables.totals.paid },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {formatCurrency(card.value)}
            </p>
          </div>
        ))}
      </div>

      {payables.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Belum ada kewajiban yang terbit pada proyek ini.
        </p>
      ) : (
        <div className="w-full rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Sumber</TableHead>
                <TableHead className="w-32">Nomor</TableHead>
                <TableHead className="min-w-40">Pihak</TableHead>
                <TableHead className="w-28">Terbit</TableHead>
                <TableHead className="w-28">Jatuh tempo</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-32 text-right">Nilai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payables.rows.map((row) => (
                <TableRow key={`${row.sourceType}-${row.sourceId}`}>
                  <TableCell className="text-muted-foreground">
                    {SOURCE_LABELS[row.sourceType]}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.reference ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell>{row.counterparty ?? EMPTY_VALUE}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDay(row.issuedOn)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.dueDate === null ? EMPTY_VALUE : formatDay(row.dueDate)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={BUCKET[row.bucket].variant}>{BUCKET[row.bucket].label}</Badge>
                    {row.bucket === 'OVERDUE' && row.daysUntilDue !== null ? (
                      <span className="ml-2 text-xs text-destructive">
                        {Math.abs(row.daysUntilDue)} hari
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.amountDue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
