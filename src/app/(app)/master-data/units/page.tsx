import { Ruler } from 'lucide-react';
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
import { EMPTY_VALUE, formatCoefficient } from '@/lib/format';
import { requireSessionUser } from '@/services/session';
import { listUnits, UNIT_DIMENSION_LABELS } from '@/services/units';

export const metadata: Metadata = { title: 'Satuan' };

export default async function UnitsPage() {
  const user = await requireSessionUser();
  const units = await listUnits(user.id);

  const byId = new Map(units.map((u) => [u.id, u]));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Satuan"
        description="Konversi hanya berlaku dalam dimensi yang sama. Satuan berbeda dimensi tidak pernah dicampur."
      />

      {units.length === 0 ? (
        <EmptyState
          icon={Ruler}
          title="Belum ada satuan"
          description="Satuan dibuat otomatis saat mengimpor daftar sumber daya dari Excel, atau dapat ditambahkan sendiri."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="w-32">Dimensi</TableHead>
                <TableHead className="w-32">Satuan dasar</TableHead>
                <TableHead className="w-32 text-right">Faktor</TableHead>
                <TableHead className="w-32 text-right">Dipakai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell className="font-mono text-xs">{unit.code}</TableCell>
                  <TableCell className="font-medium">{unit.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {UNIT_DIMENSION_LABELS[unit.dimension]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {unit.baseUnitId === null
                      ? EMPTY_VALUE
                      : (byId.get(unit.baseUnitId)?.code ?? EMPTY_VALUE)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCoefficient(unit.factorToBase)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {unit.usageCount.toLocaleString('id-ID')}
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
