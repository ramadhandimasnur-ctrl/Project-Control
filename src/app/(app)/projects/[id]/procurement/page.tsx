import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BufferPicker } from '@/features/material/buffer-picker';
import { EMPTY_VALUE, formatCurrency, formatDay, formatQuantity } from '@/lib/format';
import { getProcurementPlan, type ProcurementPlanRow } from '@/services/procurement-plan';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Rencana Pengadaan' };

const URGENCY: Record<
  ProcurementPlanRow['urgency'],
  { label: string; variant: 'destructive' | 'outline' | 'secondary' }
> = {
  LATE: { label: 'terlambat', variant: 'destructive' },
  SOON: { label: 'segera', variant: 'outline' },
  PLANNED: { label: 'terjadwal', variant: 'secondary' },
  UNSCHEDULED: { label: 'belum dijadwalkan', variant: 'outline' },
};

export default async function ProcurementPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ buffer?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();

  const requested = Number(query.buffer);
  const plan = await getProcurementPlan(user.id, projectId, {
    bufferDays: Number.isFinite(requested) ? requested : undefined,
  });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Rencana Pengadaan"
        description="Kapan tiap material harus dipesan, dihitung mundur dari tanggal mulai pekerjaan yang memakainya, dikurangi lead time pemasok dan margin pengaman."
      />

      <BufferPicker bufferDays={plan.bufferDays} />

      {plan.rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Tidak ada yang perlu dipesan"
          description="Seluruh kebutuhan material proyek ini sudah terbeli, atau AHSP RAP-nya belum disusun."
        />
      ) : (
        <>
          <div className="w-full rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead className="min-w-48">Sumber daya</TableHead>
                  <TableHead className="w-28 text-right">Sisa beli</TableHead>
                  <TableHead className="w-20 text-right">Lead</TableHead>
                  <TableHead className="w-28">Dibutuhkan</TableHead>
                  <TableHead className="w-28">Pesan paling lambat</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-32 text-right">Perkiraan nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((row) => (
                  <TableRow key={row.resourceId}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.outstanding)}
                      <span className="ml-1 text-xs text-muted-foreground">{row.unitCode}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {row.leadTimeDays} h
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.neededBy === null ? EMPTY_VALUE : formatDay(row.neededBy)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.orderBy === null ? EMPTY_VALUE : formatDay(row.orderBy)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={URGENCY[row.urgency].variant}>
                        {URGENCY[row.urgency].label}
                      </Badge>
                      {row.daysUntilOrder === null ? null : (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.daysUntilOrder < 0
                            ? `${Math.abs(row.daysUntilOrder)} hari lewat`
                            : `${row.daysUntilOrder} hari lagi`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.estimatedValue === null
                        ? EMPTY_VALUE
                        : formatCurrency(row.estimatedValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Lead time diambil dari data sumber daya di Master Data. Material yang belum punya
            pekerjaan terjadwal tidak diberi tanggal pesan — tenggat karangan lebih berbahaya
            daripada kolom yang jujur kosong, karena tidak ada yang mempertanyakannya.
          </p>
        </>
      )}
    </div>
  );
}
