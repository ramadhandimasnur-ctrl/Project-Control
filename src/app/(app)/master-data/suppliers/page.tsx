import { Truck } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE } from '@/lib/format';
import { requireSessionUser } from '@/services/session';
import { listSuppliers } from '@/services/suppliers';

export const metadata: Metadata = { title: 'Pemasok' };

export default async function SuppliersPage() {
  const user = await requireSessionUser();
  const suppliers = await listSuppliers(user.id);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pemasok"
        description="Termin kredit pemasok menggeser tanggal kas keluar pada proyeksi kebutuhan modal."
      />

      {suppliers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Belum ada pemasok"
          description="Tambahkan pemasok agar pembelian dapat ditelusuri dan termin kreditnya diperhitungkan dalam proyeksi kas."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead className="w-32 text-right">Termin (hari)</TableHead>
                <TableHead className="w-32 text-right">Pembelian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.contact ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.creditDays}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {s.purchaseCount.toLocaleString('id-ID')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
